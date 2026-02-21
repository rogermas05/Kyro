// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

/// @dev Helper that exposes SignaturePaymaster.getHash via an external call so we
///      can pass a memory-built UserOp (Foundry ABI-encodes it into calldata).
contract PaymasterHashHelper {
    SignaturePaymaster public pm;
    constructor(SignaturePaymaster _pm) { pm = _pm; }

    function computeHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) external view returns (bytes32) {
        return pm.getHash(userOp, validUntil, validAfter);
    }
}

contract Counter {
    uint256 public count;
    function increment() external { count++; }
}

contract SignaturePaymasterTest is Test {
    MinimalEntryPoint     public entryPoint;
    SignaturePaymaster    public paymaster;
    PaymasterHashHelper   public hashHelper;
    SimpleSmartAccount    public account;
    SimpleSmartAccountFactory public factory;
    Counter               public counter;

    address admin       = makeAddr("admin");
    address stranger    = makeAddr("stranger");

    uint256 sponsorPrivKey = 0xABCD;
    address sponsor;

    uint256 ownerPrivKey = 0x1234;
    address accountOwner;

    function setUp() public {
        sponsor      = vm.addr(sponsorPrivKey);
        accountOwner = vm.addr(ownerPrivKey);

        entryPoint = new MinimalEntryPoint();
        paymaster  = new SignaturePaymaster(address(entryPoint), sponsor, admin);
        hashHelper = new PaymasterHashHelper(paymaster);
        factory    = new SimpleSmartAccountFactory(address(entryPoint));
        counter    = new Counter();

        vm.prank(accountOwner);
        account = SimpleSmartAccount(payable(factory.createAccount(accountOwner, 0)));

        vm.deal(admin, 10 ether);
        vm.prank(admin);
        paymaster.deposit{value: 5 ether}();
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
        uint48 validAfter
    ) internal view returns (PackedUserOperation memory) {
        bytes32 hash = hashHelper.computeHash(op, validUntil, validAfter);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sponsorPrivKey, ethSignedHash);

        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),
            uint128(50_000),
            validUntil,
            validAfter,
            abi.encodePacked(r, s, v)
        );
        return op;
    }

    function _attachSponsorSigDefault(PackedUserOperation memory op)
        internal
        view
        returns (PackedUserOperation memory)
    {
        return _attachSponsorSig(op, uint48(block.timestamp + 300), uint48(block.timestamp));
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

    // ── Valid / Invalid Signature ────────────────────────────────────────────

    function test_ValidSponsorSigAccepted() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);
    }

    function test_InvalidSponsorSigRejected() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");

        bytes32 hash = hashHelper.computeHash(
            op,
            uint48(block.timestamp + 300),
            uint48(block.timestamp)
        );
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, ethSignedHash);

        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),
            uint128(50_000),
            uint48(block.timestamp + 300),
            uint48(block.timestamp),
            abi.encodePacked(r, s, v)
        );
        op = _signUserOp(op);

        vm.expectRevert("EntryPoint: paymaster signature failed");
        _submitOp(op);
    }

    // ── Expiry / Time Window ─────────────────────────────────────────────────

    function test_ExpiredSponsorshipRejected() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSig(op, uint48(block.timestamp - 1), uint48(block.timestamp - 100));
        op = _signUserOp(op);

        vm.expectRevert("EntryPoint: paymaster sponsorship expired");
        _submitOp(op);
    }

    function test_FutureSponsorshipRejected() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        op = _attachSponsorSig(op, uint48(block.timestamp + 600), uint48(block.timestamp + 300));
        op = _signUserOp(op);

        vm.expectRevert("EntryPoint: paymaster sponsorship not yet valid");
        _submitOp(op);
    }

    function test_ValidTimeWindowAccepted() public {
        vm.warp(1000);
        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(SimpleSmartAccount.execute, (address(counter), 0, abi.encodeCall(Counter.increment, ())))
        );
        op = _attachSponsorSig(op, uint48(block.timestamp + 300), uint48(block.timestamp - 10));
        op = _signUserOp(op);
        _submitOp(op);

        assertEq(counter.count(), 1);
    }

    // ── Paymaster deposit & admin ────────────────────────────────────────────

    function test_PaymasterDepositAndBalance() public view {
        assertGt(paymaster.getDeposit(), 0);
    }

    function test_OnlyOwnerCanUpdateSponsorSigner() public {
        vm.prank(stranger);
        vm.expectRevert();
        paymaster.setSponsorSigner(stranger);

        vm.prank(admin);
        paymaster.setSponsorSigner(stranger);
        assertEq(paymaster.sponsorSigner(), stranger);
    }

    // ── SimpleSmartAccount ───────────────────────────────────────────────────

    function test_AccountExecutesCallViaEntryPoint() public {
        vm.prank(address(entryPoint));
        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));
        assertEq(counter.count(), 1);
    }

    function test_AccountExecutesBatch() public {
        address[] memory targets = new address[](3);
        uint256[] memory values  = new uint256[](3);
        bytes[]   memory datas   = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            targets[i] = address(counter);
            values[i]  = 0;
            datas[i]   = abi.encodeCall(Counter.increment, ());
        }
        vm.prank(address(entryPoint));
        account.executeBatch(targets, values, datas);
        assertEq(counter.count(), 3);
    }

    // ── Factory ──────────────────────────────────────────────────────────────

    function test_FactoryDeploysAtDeterministicAddress() public view {
        address predicted = factory.getAddress(accountOwner, 0);
        assertEq(predicted, address(account));
    }

    function test_FactoryDifferentSaltDifferentAddress() public view {
        address a = factory.getAddress(accountOwner, 0);
        address b = factory.getAddress(accountOwner, 1);
        assertTrue(a != b);
    }

    // ── E2E: Zero-balance native sponsorship with balance deltas ─────────────

    function test_E2E_NativeSponsorship_BalanceDeltas() public {
        vm.warp(1000);
        assertEq(address(account).balance, 0);
        uint256 pmDepositBefore = paymaster.getDeposit();

        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(SimpleSmartAccount.execute, (address(counter), 0, abi.encodeCall(Counter.increment, ())))
        );
        op = _attachSponsorSigDefault(op);
        op = _signUserOp(op);
        _submitOp(op);

        assertEq(counter.count(), 1, "action should succeed");
        assertEq(address(account).balance, 0, "account should still have zero native balance");
        assertLt(paymaster.getDeposit(), pmDepositBefore, "paymaster deposit should decrease");
    }
}
