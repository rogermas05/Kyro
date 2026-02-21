// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/ERC20TokenPaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";
import "../src/mocks/MockDDSC.sol";

contract ERC20PaymasterHashHelper {
    ERC20TokenPaymaster public pm;
    constructor(ERC20TokenPaymaster _pm) { pm = _pm; }

    function computeHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter,
        uint256 maxTokenCost
    ) external view returns (bytes32) {
        return pm.getHash(userOp, validUntil, validAfter, maxTokenCost);
    }
}

contract Counter {
    uint256 public count;
    function increment() external { count++; }
}

contract ERC20TokenPaymasterTest is Test {
    MinimalEntryPoint       public entryPoint;
    ERC20TokenPaymaster     public paymaster;
    ERC20PaymasterHashHelper public hashHelper;
    SimpleSmartAccount      public account;
    SimpleSmartAccountFactory public factory;
    MockDDSC                public ddsc;
    Counter                 public counter;

    address admin    = makeAddr("admin");
    address stranger = makeAddr("stranger");

    uint256 sponsorPrivKey = 0xABCD;
    address sponsor;

    uint256 ownerPrivKey = 0x1234;
    address accountOwner;

    uint256 constant EXCHANGE_RATE = 3600e18; // 3600 DDSC per 1 ADI
    uint256 constant MAX_TOKEN_COST = 100e18; // max 100 DDSC per op

    function setUp() public {
        sponsor      = vm.addr(sponsorPrivKey);
        accountOwner = vm.addr(ownerPrivKey);

        entryPoint = new MinimalEntryPoint();
        ddsc       = new MockDDSC(admin);

        paymaster = new ERC20TokenPaymaster(
            address(entryPoint),
            sponsor,
            address(ddsc),
            EXCHANGE_RATE,
            admin
        );
        hashHelper = new ERC20PaymasterHashHelper(paymaster);
        factory    = new SimpleSmartAccountFactory(address(entryPoint));
        counter    = new Counter();

        vm.prank(accountOwner);
        account = SimpleSmartAccount(payable(factory.createAccount(accountOwner, 0)));

        // Fund paymaster's EntryPoint deposit (native tokens for gas)
        vm.deal(admin, 10 ether);
        vm.prank(admin);
        paymaster.deposit{value: 5 ether}();

        // Give smart account DDSC and approve paymaster
        vm.prank(admin);
        ddsc.mint(address(account), 1000e18);

        vm.prank(address(entryPoint));
        account.execute(
            address(ddsc), 0,
            abi.encodeCall(IERC20.approve, (address(paymaster), type(uint256).max))
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _buildUserOp(address sender, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = PackedUserOperation({
            sender:              sender,
            nonce:               entryPoint.getNonce(sender, 0),
            initCode:            "",
            callData:            callData,
            accountGasLimits:    bytes32(uint256(200_000) << 128 | uint256(100_000)),
            preVerificationGas:  50_000,
            gasFees:             bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData:    "",
            signature:           ""
        });
    }

    function _attachSponsorSig(
        PackedUserOperation memory op,
        uint48 validUntil,
        uint48 validAfter,
        uint256 maxTokenCost
    ) internal view returns (PackedUserOperation memory) {
        bytes32 hash = hashHelper.computeHash(op, validUntil, validAfter, maxTokenCost);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sponsorPrivKey, ethSignedHash);

        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),
            uint128(50_000),
            validUntil,
            validAfter,
            maxTokenCost,
            abi.encodePacked(r, s, v)
        );
        return op;
    }

    function _attachSponsorSigDefault(PackedUserOperation memory op)
        internal
        view
        returns (PackedUserOperation memory)
    {
        return _attachSponsorSig(
            op,
            uint48(block.timestamp + 300),
            uint48(block.timestamp),
            MAX_TOKEN_COST
        );
    }

    function _signUserOp(PackedUserOperation memory op)
        internal
        view
        returns (PackedUserOperation memory)
    {
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivKey, ethSignedHash);
        op.signature = abi.encodePacked(r, s, v);
        return op;
    }

    function _submitOp(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(admin));
    }

    // ── Happy path ───────────────────────────────────────────────────────────

    function test_ValidSponsorSig_ERC20() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);
    }

    function test_PostOp_DeductsTokens() public {
        vm.warp(1000);
        uint256 ddscBefore = ddsc.balanceOf(address(account));
        uint256 pmTokensBefore = ddsc.balanceOf(address(paymaster));

        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(SimpleSmartAccount.execute, (address(counter), 0, abi.encodeCall(Counter.increment, ())))
        );
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);

        assertEq(counter.count(), 1, "action should succeed");

        uint256 ddscAfter = ddsc.balanceOf(address(account));
        uint256 pmTokensAfter = ddsc.balanceOf(address(paymaster));

        assertLt(ddscAfter, ddscBefore, "account DDSC should decrease");
        assertGt(pmTokensAfter, pmTokensBefore, "paymaster should collect DDSC");
        assertEq(ddscBefore - ddscAfter, pmTokensAfter - pmTokensBefore, "tokens should be conserved");
    }

    // ── Failure: underfunded ERC20 ───────────────────────────────────────────

    function test_UnderfundedERC20_Reverts() public {
        vm.warp(1000);

        // Drain account's DDSC so it has less than maxTokenCost
        uint256 bal = ddsc.balanceOf(address(account));
        vm.prank(address(entryPoint));
        account.execute(
            address(ddsc), 0,
            abi.encodeCall(IERC20.transfer, (admin, bal))
        );

        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);

        vm.expectRevert("Paymaster: insufficient ERC20 balance");
        _submitOp(op);
    }

    // ── Failure: insufficient allowance ──────────────────────────────────────

    function test_InsufficientAllowance_Reverts() public {
        vm.warp(1000);

        // Revoke approval
        vm.prank(address(entryPoint));
        account.execute(
            address(ddsc), 0,
            abi.encodeCall(IERC20.approve, (address(paymaster), 0))
        );

        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);

        vm.expectRevert("Paymaster: insufficient ERC20 allowance");
        _submitOp(op);
    }

    // ── Failure: expired sponsorship ─────────────────────────────────────────

    function test_ExpiredSponsorship_Rejected() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSig(
            op,
            uint48(block.timestamp - 1),
            uint48(block.timestamp - 100),
            MAX_TOKEN_COST
        );
        op = _signUserOp(op);

        vm.expectRevert("EntryPoint: paymaster sponsorship expired");
        _submitOp(op);
    }

    // ── Failure: invalid sponsor sig ─────────────────────────────────────────

    function test_InvalidSponsorSig_Rejected() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");

        bytes32 hash = hashHelper.computeHash(
            op,
            uint48(block.timestamp + 300),
            uint48(block.timestamp),
            MAX_TOKEN_COST
        );
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, ethSignedHash);

        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),
            uint128(50_000),
            uint48(block.timestamp + 300),
            uint48(block.timestamp),
            MAX_TOKEN_COST,
            abi.encodePacked(r, s, v)
        );
        op = _signUserOp(op);

        vm.expectRevert("EntryPoint: paymaster signature failed");
        _submitOp(op);
    }

    // ── E2E: Full ERC20 sponsorship flow ─────────────────────────────────────

    function test_E2E_ERC20Sponsorship_FullFlow() public {
        vm.warp(1000);

        assertEq(address(account).balance, 0, "account starts with zero native");
        uint256 ddscBefore = ddsc.balanceOf(address(account));
        uint256 pmDepositBefore = paymaster.getDeposit();

        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(SimpleSmartAccount.execute, (address(counter), 0, abi.encodeCall(Counter.increment, ())))
        );
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);

        // Action succeeded
        assertEq(counter.count(), 1, "counter should increment");

        // Native: account still zero, paymaster deposit decreased
        assertEq(address(account).balance, 0, "account still zero native");
        assertLt(paymaster.getDeposit(), pmDepositBefore, "paymaster native deposit decreased");

        // ERC20: account DDSC decreased, paymaster collected DDSC
        uint256 ddscAfter = ddsc.balanceOf(address(account));
        assertLt(ddscAfter, ddscBefore, "account DDSC decreased");
        assertGt(ddsc.balanceOf(address(paymaster)), 0, "paymaster collected DDSC");
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function test_SetExchangeRate() public {
        uint256 newRate = 5000e18;
        vm.prank(admin);
        paymaster.setExchangeRate(newRate);
        assertEq(paymaster.tokenPricePerNative(), newRate);
    }

    function test_WithdrawTokens() public {
        // First do a tx so paymaster collects some tokens
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(SimpleSmartAccount.execute, (address(counter), 0, abi.encodeCall(Counter.increment, ())))
        );
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);

        uint256 collected = ddsc.balanceOf(address(paymaster));
        assertGt(collected, 0);

        uint256 adminBefore = ddsc.balanceOf(admin);
        vm.prank(admin);
        paymaster.withdrawTokens(admin, collected);
        assertEq(ddsc.balanceOf(admin), adminBefore + collected);
    }
}
