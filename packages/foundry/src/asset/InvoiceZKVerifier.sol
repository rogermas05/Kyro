// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title InvoiceZKVerifier
/// @notice Mock verifier for testnet. The "ZK proof" is a ECDSA signature
///         from a trusted off-chain oracle that attests invoice validity
///         without revealing confidential trade data on-chain.
///
///         Real mainnet upgrade path: replace verifyProof() with a
///         Groth16/PLONK verifier generated from a ZK circuit.
contract InvoiceZKVerifier is Ownable {
    using ECDSA for bytes32;

    address public trustedOracle;

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    constructor(address _trustedOracle, address owner) Ownable(owner) {
        trustedOracle = _trustedOracle;
    }

    function setTrustedOracle(address _newOracle) external onlyOwner {
        emit OracleUpdated(trustedOracle, _newOracle);
        trustedOracle = _newOracle;
    }

    /// @notice Verifies the oracle's attestation over invoice parameters.
    /// @param proof     ABI-encoded ECDSA signature (65 bytes) from trustedOracle.
    /// @param invoiceId Unique invoice identifier.
    /// @param faceValue Invoice value in DDSC (18 decimals).
    /// @param dueDate   Unix timestamp of invoice due date.
    /// @param docHash   Keccak256 hash of off-chain invoice document.
    function verifyProof(
        bytes calldata proof,
        bytes32 invoiceId,
        uint256 faceValue,
        uint64 dueDate,
        bytes32 docHash
    ) external view returns (bool) {
        bytes32 messageHash = keccak256(abi.encodePacked(invoiceId, faceValue, dueDate, docHash));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethSignedHash, proof);
        return recovered == trustedOracle;
    }
}
