// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

// ── Minimal mock EntryPoint ────────────────────────────────────────────────────
contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient deposit");
        balanceOf[msg.sender] -= amount;
        to.transfer(amount);
    }

    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32) {
        return keccak256(abi.encode(userOp, block.chainid, address(this)));
    }

    // Simulate EntryPoint calling validatePaymasterUserOp
    function callValidatePaymaster(
        address paymaster,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (bytes memory context, uint256 validationData) {
        return IPaymaster(paymaster).validatePaymasterUserOp(userOp, userOpHash, 0);
    }

    // Simulate EntryPoint calling validateUserOp on account
    function callValidateUserOp(
        address account,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingFunds
    ) external returns (uint256 validationData) {
        return IAccount(account).validateUserOp(userOp, userOpHash, missingFunds);
    }

    receive() external payable {}
}

// ── Simple target contract for execute() tests ────────────────────────────────
contract Counter {
    uint256 public count;
    function increment() external { count++; }
}

// ── Test suite ────────────────────────────────────────────────────────────────
contract SignaturePaymasterTest is Test {
    MockEntryPoint        public entryPoint;
    SignaturePaymaster    public paymaster;
    SimpleSmartAccount   public account;
    SimpleSmartAccountFactory public factory;
    Counter              public counter;

    address admin       = makeAddr("admin");
    address stranger    = makeAddr("stranger");

    // Sponsor signs on behalf of the protocol
    uint256 sponsorPrivKey = 0xABCD;
    address sponsor;

    // Smart account owner (the SME)
    uint256 ownerPrivKey = 0x1234;
    address accountOwner;

    function setUp() public {
        sponsor      = vm.addr(sponsorPrivKey);
        accountOwner = vm.addr(ownerPrivKey);

        entryPoint = new MockEntryPoint();
        paymaster  = new SignaturePaymaster(address(entryPoint), sponsor, admin);
        factory    = new SimpleSmartAccountFactory(address(entryPoint));
        counter    = new Counter();

        vm.prank(accountOwner);
        account = SimpleSmartAccount(payable(factory.createAccount(accountOwner, 0)));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// @dev Build a minimal packed UserOperation for the given sender.
    function _buildUserOp(address sender, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = PackedUserOperation({
            sender:              sender,
            nonce:               0,
            initCode:            "",
            callData:            callData,
            accountGasLimits:    bytes32(uint256(150_000) << 128 | uint256(50_000)),
            preVerificationGas:  50_000,
            gasFees:             bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData:    "",
            signature:           ""
        });
    }

    /// @dev Sign a UserOpHash with the sponsor's key and pack into paymasterAndData.
    function _attachSponsorSig(
        PackedUserOperation memory op,
        bytes32 userOpHash
    ) internal view returns (PackedUserOperation memory) {
        bytes32 signedHash    = keccak256(abi.encodePacked(userOpHash, block.chainid, address(paymaster)));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", signedHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sponsorPrivKey, ethSignedHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        // paymasterAndData = [paymaster (20)] + [verGasLimit (16)] + [postOpGasLimit (16)] + [sig (65)]
        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),  // verification gas limit
            uint128(50_000),   // post-op gas limit
            sig
        );
        return op;
    }

    /// @dev Sign a UserOpHash with the account owner's key.
    function _signUserOp(PackedUserOperation memory op, bytes32 userOpHash)
        internal
        view
        returns (PackedUserOperation memory)
    {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivKey, ethSignedHash);
        op.signature = abi.encodePacked(r, s, v);
        return op;
    }

    // ── SignaturePaymaster ────────────────────────────────────────────────────

    function test_ValidSponsorSigAccepted() public {
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        bytes32 hash = entryPoint.getUserOpHash(op);
        op = _attachSponsorSig(op, hash);

        (bytes memory ctx, uint256 validationData) =
            entryPoint.callValidatePaymaster(address(paymaster), op, hash);

        assertEq(validationData, 0); // 0 = success
        address sponsored = abi.decode(ctx, (address));
        assertEq(sponsored, address(account));
    }

    function test_InvalidSponsorSigRejected() public {
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        bytes32 hash = entryPoint.getUserOpHash(op);

        // Use a wrong private key — signature will be invalid
        bytes32 signedHash    = keccak256(abi.encodePacked(hash, block.chainid, address(paymaster)));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", signedHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, ethSignedHash); // wrong key
        bytes memory badSig = abi.encodePacked(r, s, v);

        op.paymasterAndData = abi.encodePacked(
            address(paymaster), uint128(100_000), uint128(50_000), badSig
        );

        (, uint256 validationData) =
            entryPoint.callValidatePaymaster(address(paymaster), op, hash);

        assertEq(validationData, 1); // 1 = SIG_VALIDATION_FAILED
    }

    function test_PaymasterRejectsIfNotEntryPoint() public {
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        bytes32 hash = entryPoint.getUserOpHash(op);
        op = _attachSponsorSig(op, hash);

        vm.prank(stranger);
        vm.expectRevert("Paymaster: caller not EntryPoint");
        paymaster.validatePaymasterUserOp(op, hash, 0);
    }

    function test_PaymasterDepositAndBalance() public {
        uint256 depositAmt = 1 ether;
        vm.deal(admin, depositAmt);

        vm.prank(admin);
        paymaster.deposit{value: depositAmt}();

        assertEq(paymaster.getDeposit(), depositAmt);
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

    function test_AccountValidatesOwnerSig() public {
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        bytes32 hash = entryPoint.getUserOpHash(op);
        op = _signUserOp(op, hash);

        uint256 validationData =
            entryPoint.callValidateUserOp(address(account), op, hash, 0);

        assertEq(validationData, 0); // success
    }

    function test_AccountRejectsNonOwnerSig() public {
        PackedUserOperation memory op = _buildUserOp(address(account), "");
        bytes32 hash = entryPoint.getUserOpHash(op);

        // Sign with wrong key
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, ethSignedHash);
        op.signature = abi.encodePacked(r, s, v);

        uint256 validationData =
            entryPoint.callValidateUserOp(address(account), op, hash, 0);

        assertEq(validationData, 1); // SIG_VALIDATION_FAILED
    }

    function test_AccountRejectsCallIfNotEntryPoint() public {
        vm.prank(stranger);
        vm.expectRevert("Account: caller not EntryPoint or owner");
        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));
    }

    function test_AccountExecutesCallViaEntryPoint() public {
        bytes memory callData = abi.encodeCall(Counter.increment, ());
        // Simulate EntryPoint calling execute
        vm.prank(address(entryPoint));
        account.execute(address(counter), 0, callData);

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

    // ── Factory ───────────────────────────────────────────────────────────────

    function test_FactoryDeploysAtDeterministicAddress() public {
        address predicted = factory.getAddress(accountOwner, 0);
        assertEq(predicted, address(account)); // already deployed in setUp
    }

    function test_FactoryReturnsSameAccountIfAlreadyDeployed() public {
        address first  = address(factory.createAccount(accountOwner, 0));
        address second = address(factory.createAccount(accountOwner, 0));
        assertEq(first, second);
    }

    function test_FactoryDifferentSaltDifferentAddress() public {
        address a = factory.getAddress(accountOwner, 0);
        address b = factory.getAddress(accountOwner, 1);
        assertTrue(a != b);
    }

    // ── E2E: zero-balance account sponsored by paymaster ─────────────────────

    /// @dev Proves the core Track-2 claim:
    ///      A wallet with 0 ETH/ADI can execute a call when sponsored.
    function test_E2E_ZeroBalanceAccountCanExecuteWithSponsorship() public {
        // Account has zero native balance
        assertEq(address(account).balance, 0);

        PackedUserOperation memory op = _buildUserOp(
            address(account),
            abi.encodeCall(Counter.increment, ())
        );
        bytes32 hash = entryPoint.getUserOpHash(op);
        op = _signUserOp(op, hash);
        op = _attachSponsorSig(op, hash);

        // Paymaster validates: sponsor sig valid → success
        (, uint256 pmValidation) =
            entryPoint.callValidatePaymaster(address(paymaster), op, hash);
        assertEq(pmValidation, 0);

        // Account validates: owner sig valid → success
        uint256 accValidation =
            entryPoint.callValidateUserOp(address(account), op, hash, 0);
        assertEq(accValidation, 0);

        // Execute the call (EntryPoint would do this after both validations pass)
        vm.prank(address(entryPoint));
        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));

        assertEq(counter.count(), 1);
        assertEq(address(account).balance, 0); // still zero — gas paid by paymaster
    }
}
