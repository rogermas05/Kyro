// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ERC4337.sol";

/// @title MinimalEntryPoint
/// @notice Simplified ERC-4337 v0.7 EntryPoint for testnet / anvil deployment.
///         Implements the full IEntryPoint interface with basic UserOp handling:
///           1. Validate paymaster signature
///           2. Validate account signature
///           3. Execute callData on the sender account
///           4. Call postOp on paymaster
///
/// NOT audited — for demo and development only.
/// Real deployment: use eth-infinitism/account-abstraction EntryPoint v0.7.
contract MinimalEntryPoint is IEntryPoint {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(uint192 => uint256)) private _nonces;

    // ── IEntryPoint ───────────────────────────────────────────────────────────

    function depositTo(address account) external payable override {
        balanceOf[account] += msg.value;
        emit Deposited(account, balanceOf[account]);
    }

    function withdrawTo(address payable to, uint256 amount) external override {
        require(balanceOf[msg.sender] >= amount, "EntryPoint: insufficient deposit");
        balanceOf[msg.sender] -= amount;
        to.transfer(amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function getNonce(address sender, uint192 key) external view override returns (uint256) {
        return _nonces[sender][key];
    }

    function getUserOpHash(PackedUserOperation calldata userOp) external view override returns (bytes32) {
        return keccak256(abi.encode(
            keccak256(abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )),
            block.chainid,
            address(this)
        ));
    }

    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external override {
        for (uint256 i = 0; i < ops.length; i++) {
            _handleOp(ops[i]);
        }
        // Send any accumulated gas refunds to beneficiary (simplified)
        if (address(this).balance > 0) {
            beneficiary.transfer(address(this).balance);
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _handleOp(PackedUserOperation calldata op) internal {
        bytes32 opHash = this.getUserOpHash(op);

        // 1. Validate paymaster (if present in paymasterAndData)
        bytes memory pmContext;
        if (op.paymasterAndData.length >= 20) {
            address pm = address(bytes20(op.paymasterAndData[:20]));
            (pmContext,) = IPaymaster(pm).validatePaymasterUserOp(op, opHash, 0);
        }

        // 2. Validate account signature
        uint256 validationResult = IAccount(op.sender).validateUserOp(op, opHash, 0);
        require(validationResult == 0, "EntryPoint: account validation failed");
        _nonces[op.sender][0]++;

        // 3. Execute callData on the smart account
        if (op.callData.length > 0) {
            (bool success,) = op.sender.call(op.callData);
            if (!success) {
                // Emit a failure event rather than reverting so bundler can continue
                emit UserOperationRevertReason(opHash, op.sender, op.nonce, "execution reverted");
            }
        }

        // 4. Post-op on paymaster
        if (op.paymasterAndData.length >= 20) {
            address pm = address(bytes20(op.paymasterAndData[:20]));
            IPaymaster(pm).postOp(PostOpMode.opSucceeded, pmContext, 0, 0);
        }

        emit UserOperationEvent(opHash, op.sender, address(0), op.nonce, true, 0, 0);
    }

    // ── Events (subset of ERC-4337 EntryPoint events) ────────────────────────

    event Deposited(address indexed account, uint256 totalDeposit);
    event Withdrawn(address indexed account, address withdrawAddress, uint256 amount);
    event UserOperationEvent(
        bytes32 indexed userOpHash, address indexed sender, address indexed paymaster,
        uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed
    );
    event UserOperationRevertReason(
        bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason
    );

    receive() external payable {}
}
