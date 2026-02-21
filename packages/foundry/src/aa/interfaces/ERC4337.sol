// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Packed UserOperation structure (ERC-4337 v0.7).
///         gasLimits packs verificationGasLimit (high 128 bits) + callGasLimit (low 128 bits).
///         gasFees   packs maxPriorityFeePerGas (high 128 bits) + maxFeePerGas (low 128 bits).
struct PackedUserOperation {
    address   sender;
    uint256   nonce;
    bytes     initCode;
    bytes     callData;
    bytes32   accountGasLimits;  // verificationGasLimit | callGasLimit
    uint256   preVerificationGas;
    bytes32   gasFees;           // maxPriorityFeePerGas | maxFeePerGas
    bytes     paymasterAndData;
    bytes     signature;
}

/// @notice Paymaster post-op mode.
enum PostOpMode { opSucceeded, opReverted, postOpReverted }

/// @notice Minimal IEntryPoint interface — only what our contracts call.
interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function balanceOf(address account) external view returns (uint256);
    function getNonce(address sender, uint192 key) external view returns (uint256);
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
}

/// @notice IPaymaster interface (ERC-4337 v0.7).
interface IPaymaster {
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

/// @notice IAccount interface (ERC-4337 v0.7).
interface IAccount {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}
