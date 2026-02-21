// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/merchant/PriceOracle.sol";
import "../src/merchant/MockSwapRouter.sol";
import "../src/merchant/ADIPayRouter.sol";
import "../src/mocks/MockDDSC.sol";
import "../src/mocks/MockADI.sol";

contract ADIPayRouterTest is Test {
    PriceOracle    public oracle;
    MockSwapRouter public swapRouter;
    ADIPayRouter   public payRouter;
    MockDDSC       public ddsc;
    MockADI        public madi;

    address admin    = makeAddr("admin");
    address merchant = makeAddr("merchant");
    address customer = makeAddr("customer");
    address stranger = makeAddr("stranger");
    address feeRecip = makeAddr("feeRecipient");

    // Rates: token-wei per 1 AED (1e18)
    // DDSC: 1 DDSC = 1 AED → rate = 1e18
    // mADI: 1 ADI  = 2 AED → 1 AED = 0.5 ADI → rate = 5e17
    uint256 constant DDSC_RATE = 1e18;
    uint256 constant MADI_RATE = 5e17;

    function setUp() public {
        vm.startPrank(admin);

        ddsc       = new MockDDSC(admin);
        madi       = new MockADI(admin);
        oracle     = new PriceOracle(admin);
        swapRouter = new MockSwapRouter(address(oracle), admin);
        payRouter  = new ADIPayRouter(address(oracle), address(swapRouter), admin);

        oracle.setRate(address(ddsc), DDSC_RATE);
        oracle.setRate(address(madi), MADI_RATE);

        // Pre-fund customer
        ddsc.mint(customer, 10_000e18);
        madi.mint(customer, 10_000e18);

        // Pre-fund swap router reserves (DDSC and mADI)
        ddsc.mint(admin, 50_000e18);
        madi.mint(admin, 50_000e18);
        ddsc.approve(address(swapRouter), 50_000e18);
        madi.approve(address(swapRouter), 50_000e18);
        swapRouter.depositReserves(address(ddsc), 50_000e18);
        swapRouter.depositReserves(address(madi), 50_000e18);

        vm.stopPrank();
    }

    // ── PriceOracle ───────────────────────────────────────────────────────────

    function test_OracleReturnsCorrectRate() public view {
        assertEq(oracle.getRate(address(ddsc)), DDSC_RATE);
        assertEq(oracle.getRate(address(madi)), MADI_RATE);
    }

    function test_OracleFiatToToken_DDSC() public view {
        // 500 AED in DDSC (1:1) → 500 DDSC
        uint256 amount = oracle.fiatToToken(500e18, address(ddsc));
        assertEq(amount, 500e18);
    }

    function test_OracleFiatToToken_MADI() public view {
        // 500 AED in mADI (1 ADI = 2 AED) → 250 mADI
        uint256 amount = oracle.fiatToToken(500e18, address(madi));
        assertEq(amount, 250e18);
    }

    function test_OracleRevertsForUnregisteredToken() public {
        vm.expectRevert("Oracle: no rate for token");
        oracle.getRate(makeAddr("unknownToken"));
    }

    function test_OracleOnlyOwnerCanSetRate() public {
        vm.prank(stranger);
        vm.expectRevert();
        oracle.setRate(makeAddr("t"), 1e18);
    }

    // ── MockSwapRouter ────────────────────────────────────────────────────────

    function test_SwapDDSCForMADI() public {
        // 500 DDSC → 250 mADI (because 1 DDSC = 1 AED, 1 mADI = 2 AED → 0.5 mADI per DDSC)
        vm.startPrank(customer);
        ddsc.approve(address(swapRouter), 500e18);
        uint256 amountOut = swapRouter.swap(address(ddsc), address(madi), 500e18, customer);
        vm.stopPrank();

        assertEq(amountOut, 250e18);
        assertEq(madi.balanceOf(customer), 10_000e18 + 250e18);
    }

    function test_SwapMADIForDDSC() public {
        // 250 mADI → 500 DDSC
        vm.startPrank(customer);
        madi.approve(address(swapRouter), 250e18);
        uint256 amountOut = swapRouter.swap(address(madi), address(ddsc), 250e18, customer);
        vm.stopPrank();

        assertEq(amountOut, 500e18);
        assertEq(ddsc.balanceOf(customer), 10_000e18 + 500e18);
    }

    function test_SwapPreview() public view {
        uint256 preview = swapRouter.previewSwap(address(ddsc), address(madi), 500e18);
        assertEq(preview, 250e18);
    }

    function test_SwapRevertsIfInsufficientReserves() public {
        // Router holds 50_000 mADI. Swapping 110_000 DDSC needs 55_000 mADI → exceeds reserves.
        vm.prank(admin);
        ddsc.mint(customer, 110_000e18); // give customer enough to pass ERC20 balance check

        vm.startPrank(customer);
        ddsc.approve(address(swapRouter), 110_000e18);
        vm.expectRevert("SwapRouter: insufficient reserves");
        swapRouter.swap(address(ddsc), address(madi), 110_000e18, customer);
        vm.stopPrank();
    }

    function test_SwapRevertsIdenticalTokens() public {
        vm.startPrank(customer);
        ddsc.approve(address(swapRouter), 100e18);
        vm.expectRevert("SwapRouter: identical tokens");
        swapRouter.swap(address(ddsc), address(ddsc), 100e18, customer);
        vm.stopPrank();
    }

    // ── ADIPayRouter: same-token checkout ────────────────────────────────────

    function test_CheckoutSameToken_NoPriceImpact() public {
        // 500 AED paid in DDSC, merchant wants DDSC (no swap)
        vm.startPrank(customer);
        ddsc.approve(address(payRouter), 500e18);
        payRouter.checkout(merchant, 500e18, address(ddsc), address(ddsc));
        vm.stopPrank();

        assertEq(ddsc.balanceOf(merchant),  500e18);
        assertEq(ddsc.balanceOf(customer),  10_000e18 - 500e18);
    }

    function test_CheckoutSameToken_EmitsEvent() public {
        vm.startPrank(customer);
        ddsc.approve(address(payRouter), 500e18);
        vm.expectEmit(true, true, false, true);
        emit ADIPayRouter.CheckoutCompleted(
            merchant, customer, 500e18, address(ddsc), 500e18, address(ddsc), 500e18
        );
        payRouter.checkout(merchant, 500e18, address(ddsc), address(ddsc));
        vm.stopPrank();
    }

    // ── ADIPayRouter: cross-token checkout (with swap) ────────────────────────

    function test_CheckoutCrossToken_MADIToDDSC() public {
        // Customer pays in mADI, merchant receives DDSC
        // 500 AED → 250 mADI → 500 DDSC (swap at 2x rate)
        vm.startPrank(customer);
        madi.approve(address(payRouter), 500e18); // plenty of allowance
        payRouter.checkout(merchant, 500e18, address(madi), address(ddsc));
        vm.stopPrank();

        // Customer spent 250 mADI (500 AED / 2 AED per ADI)
        assertEq(madi.balanceOf(customer), 10_000e18 - 250e18);
        // Merchant received 500 DDSC
        assertEq(ddsc.balanceOf(merchant), 500e18);
    }

    function test_CheckoutCrossToken_DDSCToMADI() public {
        // Customer pays in DDSC, merchant receives mADI
        // 300 AED → 300 DDSC → 150 mADI
        vm.startPrank(customer);
        ddsc.approve(address(payRouter), 500e18);
        payRouter.checkout(merchant, 300e18, address(ddsc), address(madi));
        vm.stopPrank();

        assertEq(ddsc.balanceOf(customer), 10_000e18 - 300e18);
        assertEq(madi.balanceOf(merchant), 150e18);
    }

    // ── Fee ───────────────────────────────────────────────────────────────────

    function test_FeeDeductedOnCheckout() public {
        // Set 1% fee
        vm.prank(admin);
        payRouter.setFee(100, feeRecip); // 100 bps = 1%

        // 500 AED in DDSC → 500 DDSC → fee 5 DDSC → merchant 495 DDSC
        vm.startPrank(customer);
        ddsc.approve(address(payRouter), 500e18);
        payRouter.checkout(merchant, 500e18, address(ddsc), address(ddsc));
        vm.stopPrank();

        assertEq(ddsc.balanceOf(merchant),  495e18);
        assertEq(ddsc.balanceOf(feeRecip),    5e18);
    }

    function test_FeeCannotExceed2Percent() public {
        vm.prank(admin);
        vm.expectRevert("Fee: max 2%");
        payRouter.setFee(201, feeRecip);
    }

    function test_OnlyOwnerCanSetFee() public {
        vm.prank(stranger);
        vm.expectRevert();
        payRouter.setFee(50, feeRecip);
    }

    // ── previewCheckout ───────────────────────────────────────────────────────

    function test_PreviewCheckoutMatchesActual() public {
        uint256 preview = payRouter.previewCheckout(500e18, address(madi));
        assertEq(preview, 250e18); // 500 AED / 2 AED per ADI = 250 mADI

        // Verify actual checkout charges the same
        vm.startPrank(customer);
        madi.approve(address(payRouter), preview);
        payRouter.checkout(merchant, 500e18, address(madi), address(ddsc));
        vm.stopPrank();

        assertEq(madi.balanceOf(customer), 10_000e18 - preview);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    /// @dev For any AED fiat amount, the DDSC checkout always charges exactly
    ///      fiatAmount (since DDSC is 1:1 with AED).
    function testFuzz_DDSCCheckoutAlways1to1(uint256 fiatAmount) public {
        fiatAmount = bound(fiatAmount, 1e15, 5_000e18); // 0.001 – 5000 AED

        vm.prank(admin);
        ddsc.mint(customer, fiatAmount);

        vm.startPrank(customer);
        ddsc.approve(address(payRouter), fiatAmount);
        payRouter.checkout(merchant, fiatAmount, address(ddsc), address(ddsc));
        vm.stopPrank();

        assertEq(ddsc.balanceOf(merchant), fiatAmount);
    }

    /// @dev For any AED amount, cross-token checkout preserves AED value:
    ///      mADI in → DDSC out should equal the original fiatAmount in DDSC.
    function testFuzz_CrossTokenPreservesValue(uint256 fiatAmount) public {
        fiatAmount = bound(fiatAmount, 1e18, 5_000e18); // 1 – 5000 AED (whole ADI units)

        uint256 madiNeeded = fiatAmount * MADI_RATE / 1e18;

        vm.prank(admin);
        madi.mint(customer, madiNeeded);

        vm.startPrank(customer);
        madi.approve(address(payRouter), madiNeeded);
        payRouter.checkout(merchant, fiatAmount, address(madi), address(ddsc));
        vm.stopPrank();

        // Merchant receives fiatAmount in DDSC (1 DDSC = 1 AED).
        // At 2:1 rates, integer division can lose 1 wei on odd amounts.
        assertApproxEqAbs(ddsc.balanceOf(merchant), fiatAmount, 1);
    }
}
