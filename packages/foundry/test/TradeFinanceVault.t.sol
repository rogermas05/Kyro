// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/identity/IdentityRegistry.sol";
import "../src/identity/ClaimTopicsRegistry.sol";
import "../src/identity/TrustedIssuersRegistry.sol";
import "../src/asset/InvoiceToken.sol";
import "../src/asset/SeniorToken.sol";
import "../src/asset/JuniorToken.sol";
import "../src/asset/InvoiceZKVerifier.sol";
import "../src/asset/InvoiceOrchestrator.sol";
import "../src/vault/TradeFinanceVault.sol";
import "../src/mocks/MockDDSC.sol";

contract TradeFinanceVaultTest is Test {
    // ── Contracts ─────────────────────────────────────────────────────────────
    ClaimTopicsRegistry    public claimTopics;
    TrustedIssuersRegistry public trustedIssuers;
    IdentityRegistry       public registry;
    InvoiceToken           public invoiceToken;
    SeniorToken            public seniorToken;
    JuniorToken            public juniorToken;
    InvoiceZKVerifier      public verifier;
    InvoiceOrchestrator    public orchestrator;
    TradeFinanceVault      public vault;
    MockDDSC               public ddsc;

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin       = makeAddr("admin");
    address sme         = makeAddr("sme");
    address institution = makeAddr("institution");
    address stranger    = makeAddr("stranger");

    uint256 oraclePrivKey = 0xBEEF;
    address oracle;

    // ── Invoice params ────────────────────────────────────────────────────────
    bytes32 invoiceId  = keccak256("INV-001");
    uint256 faceValue  = 1000e18; // 1000 DDSC
    uint256 seniorAmt  = 800e18;  // 80%
    uint256 juniorAmt  = 200e18;  // 20%
    uint64  dueDate;
    bytes32 docHash    = keccak256("shipping-docs");
    address counterparty = makeAddr("buyer");

    // ── Deposit size ──────────────────────────────────────────────────────────
    uint256 depositAmount = 5000e18; // institution deposits 5000 DDSC

    function setUp() public {
        oracle  = vm.addr(oraclePrivKey);
        dueDate = uint64(block.timestamp + 30 days);

        vm.startPrank(admin);

        // Identity layer
        claimTopics   = new ClaimTopicsRegistry(admin);
        trustedIssuers = new TrustedIssuersRegistry(admin);
        registry      = new IdentityRegistry(admin, address(claimTopics), address(trustedIssuers));

        // Tokens
        invoiceToken = new InvoiceToken(admin, address(registry));
        seniorToken  = new SeniorToken(admin, address(registry));
        juniorToken  = new JuniorToken(admin, address(registry));

        // Verifier + DDSC
        verifier = new InvoiceZKVerifier(oracle, admin);
        ddsc     = new MockDDSC(admin);

        // Orchestrator
        orchestrator = new InvoiceOrchestrator(
            admin,
            address(registry),
            address(invoiceToken),
            address(seniorToken),
            address(juniorToken),
            address(verifier),
            address(ddsc)
        );

        // Vault
        vault = new TradeFinanceVault(
            address(ddsc),
            admin,
            address(registry),
            address(seniorToken)
        );

        // ── Wire up roles ─────────────────────────────────────────────────────
        // Orchestrator gets minting rights on all tokens
        invoiceToken.grantRole(invoiceToken.MINTER_ROLE(), address(orchestrator));
        seniorToken.grantRole(seniorToken.MINTER_ROLE(), address(orchestrator));
        juniorToken.grantRole(juniorToken.MINTER_ROLE(), address(orchestrator));

        // Link vault ↔ orchestrator
        orchestrator.setVault(address(vault));
        vault.setOrchestrator(address(orchestrator));

        // ── KYC registrations ─────────────────────────────────────────────────
        registry.registerIdentity(sme, 784);
        registry.setKycStatus(sme, true);

        registry.registerIdentity(institution, 784);
        registry.setKycStatus(institution, true);

        // Vault contract itself must be KYC'd to receive S-DEBT transfers
        registry.registerIdentity(address(vault), 784);
        registry.setKycStatus(address(vault), true);

        // ── Fund institution with DDSC ─────────────────────────────────────────
        ddsc.mint(institution, depositAmount);

        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _makeProof() internal view returns (bytes memory) {
        bytes32 msgHash = keccak256(abi.encodePacked(invoiceId, faceValue, dueDate, docHash));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _mintInvoice() internal {
        vm.prank(sme);
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, _makeProof());
    }

    function _depositInstitution() internal {
        vm.startPrank(institution);
        ddsc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, institution);
        vm.stopPrank();
    }

    function _purchaseTranche() internal {
        vm.prank(admin);
        vault.purchaseSeniorTranche(invoiceId);
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    function test_DepositIssuesSharesAtParity() public {
        _depositInstitution();
        assertEq(vault.balanceOf(institution), depositAmount); // 1:1 initially
        assertEq(vault.totalAssets(), depositAmount);
    }

    function test_DepositRevertsIfNotKYC() public {
        vm.prank(admin);
        ddsc.mint(stranger, 1000e18);

        vm.startPrank(stranger);
        ddsc.approve(address(vault), 1000e18);
        vm.expectRevert();
        vault.deposit(1000e18, stranger);
        vm.stopPrank();
    }

    function test_VaultShareTransferToUnverifiedReverts() public {
        _depositInstitution();

        vm.prank(institution);
        vm.expectRevert("Vault: recipient not KYC verified");
        vault.transfer(stranger, 100e18);
    }

    // ── totalAssets ───────────────────────────────────────────────────────────

    function test_TotalAssetsEqualsDepositedDDSC() public {
        _depositInstitution();
        assertEq(vault.totalAssets(), depositAmount);
    }

    function test_TotalAssetsUnchangedAfterPurchase() public {
        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        // DDSC decreased by seniorAmt, S-DEBT increased by seniorAmt → net zero
        uint256 expectedDdsc  = depositAmount - seniorAmt;
        uint256 expectedSDebt = seniorAmt;
        assertEq(ddsc.balanceOf(address(vault)), expectedDdsc);
        assertEq(seniorToken.balanceOf(address(vault)), expectedSDebt);
        assertEq(vault.totalAssets(), depositAmount); // unchanged ✓
    }

    // ── purchaseSeniorTranche ─────────────────────────────────────────────────

    function test_PurchaseSendsDdscToSme() public {
        _mintInvoice();
        _depositInstitution();

        uint256 smeBefore = ddsc.balanceOf(sme);
        _purchaseTranche();

        assertEq(ddsc.balanceOf(sme) - smeBefore, seniorAmt);
    }

    function test_PurchaseTransfersSDebtToVault() public {
        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        assertEq(seniorToken.balanceOf(address(vault)), seniorAmt);
    }

    function test_PurchaseRevertsIfInsufficientLiquidity() public {
        _mintInvoice();
        // Deposit only 100 DDSC — not enough for 800 DDSC senior tranche
        vm.prank(admin);
        ddsc.mint(institution, 0); // already has 5000, but we skip deposit
        // Don't deposit at all → vault has 0 DDSC
        vm.prank(admin);
        vm.expectRevert("Insufficient DDSC liquidity");
        vault.purchaseSeniorTranche(invoiceId);
    }

    function test_PurchaseRevertsIfNotOperator() public {
        _mintInvoice();
        _depositInstitution();

        vm.prank(stranger);
        vm.expectRevert();
        vault.purchaseSeniorTranche(invoiceId);
    }

    // ── Settlement → Yield ────────────────────────────────────────────────────

    function test_SharePriceRisesAfterSettlement() public {
        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        // totalAssets = 5000 DDSC, totalSupply = 5000 shares → price = 1.00

        // Simulate full repayment: 1000 DDSC principal + 60 DDSC interest (6%)
        uint256 repayment = 1060e18;
        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);

        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        // After settlement:
        //   Orchestrator burned 800 S-DEBT from vault
        //   Orchestrator sent 1060 DDSC to vault
        //   Vault DDSC: (5000 - 800) + 1060 = 5260
        //   Vault S-DEBT: 0
        //   totalAssets = 5260

        assertEq(seniorToken.balanceOf(address(vault)), 0);
        assertEq(vault.totalAssets(), depositAmount + 260e18); // +260 DDSC net gain
    }

    function test_RedeemAfterSettlementReturnsYield() public {
        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        uint256 repayment = 1060e18;
        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);
        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        uint256 shares = vault.balanceOf(institution);
        uint256 ddscBefore = ddsc.balanceOf(institution);

        vm.prank(institution);
        vault.redeem(shares, institution, institution);

        uint256 ddscReceived = ddsc.balanceOf(institution) - ddscBefore;

        // Institution deposited 5000, should receive ~5260
        // ERC-4626 rounds down on redemption by at most 1 wei
        assertApproxEqAbs(ddscReceived, depositAmount + 260e18, 1);
    }

    // ── Default ───────────────────────────────────────────────────────────────

    function test_TotalAssetsDropsOnDefault() public {
        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        // Only 50% recovery
        uint256 recovered = 500e18;
        vm.prank(admin);
        ddsc.mint(address(orchestrator), recovered);

        vm.prank(admin);
        orchestrator.defaultInvoice(invoiceId);

        // S-DEBT burned, only 500 DDSC recovered (vs 800 owed)
        // DDSC in vault: (5000 - 800) + 500 = 4700
        assertEq(vault.totalAssets(), depositAmount - 300e18); // −300 loss
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    /// @dev Share price after settlement always > 1 when repayment > face value.
    function testFuzz_YieldAlwaysPositiveOnFullRepayment(uint256 interestBps) public {
        interestBps = bound(interestBps, 1, 2000); // 0.01% – 20% interest

        _mintInvoice();
        _depositInstitution();
        _purchaseTranche();

        uint256 interest  = seniorAmt * interestBps / 10000;
        uint256 repayment = faceValue + interest; // principal + interest

        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);
        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        // totalAssets must exceed original deposit
        assertGt(vault.totalAssets(), depositAmount);
    }
}
