// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/ERC4337.sol";

/// @title SimpleSmartAccount
/// @notice Minimal ERC-4337 v0.7 smart account owned by a single EOA.
///
/// Purpose: Allows an SME to call mintInvoice() without holding any ADI.
///   - The account holds any assets needed for contract interactions.
///   - Gas is sponsored by the SignaturePaymaster.
///   - The owner's EOA signs UserOperations off-chain; this contract verifies them.
///
/// Deployment: Typically done via SimpleSmartAccountFactory using CREATE2 so the
///             address is deterministic and can be funded/KYC'd before deployment.
contract SimpleSmartAccount is IAccount {
    using ECDSA for bytes32;

    uint256 public constant SIG_VALIDATION_SUCCESS = 0;
    uint256 public constant SIG_VALIDATION_FAILED  = 1;

    address public immutable owner;
    address public immutable entryPoint;

    event Executed(address indexed target, uint256 value, bytes data);

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Account: caller not EntryPoint");
        _;
    }

    modifier onlyEntryPointOrOwner() {
        require(
            msg.sender == entryPoint || msg.sender == owner,
            "Account: caller not EntryPoint or owner"
        );
        _;
    }

    constructor(address _owner, address _entryPoint) {
        owner      = _owner;
        entryPoint = _entryPoint;
    }

    // ── IAccount ──────────────────────────────────────────────────────────────

    /// @notice EntryPoint calls this to verify the UserOperation signature.
    ///         Returns 0 on success, 1 on failure.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override onlyEntryPoint returns (uint256 validationData) {
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        address recovered = ECDSA.recover(ethSignedHash, userOp.signature);

        if (recovered != owner) {
            return SIG_VALIDATION_FAILED;
        }

        // Pre-fund the EntryPoint if it doesn't have enough to cover this op
        if (missingAccountFunds > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = payable(entryPoint).call{value: missingAccountFunds}("");
            require(success, "Account: failed to pre-fund EntryPoint");
        }

        return SIG_VALIDATION_SUCCESS;
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /// @notice Execute a single call. Called by EntryPoint after validation.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyEntryPointOrOwner
    {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(target, value, data);
    }

    /// @notice Execute a batch of calls atomically.
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[]   calldata datas
    ) external onlyEntryPointOrOwner {
        require(targets.length == values.length && values.length == datas.length, "Account: length mismatch");
        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, bytes memory result) = targets[i].call{value: values[i]}(datas[i]);
            if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }
    }

    receive() external payable {}
}
