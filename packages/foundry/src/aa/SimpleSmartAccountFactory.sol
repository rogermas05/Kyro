// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SimpleSmartAccount.sol";

/// @title SimpleSmartAccountFactory
/// @notice Deploys SimpleSmartAccount instances at deterministic CREATE2 addresses.
///         The address is determined by (owner, salt), so it can be computed and
///         KYC-registered before the account is deployed.
contract SimpleSmartAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(address _entryPoint) {
        entryPoint = _entryPoint;
    }

    /// @notice Deploy (or return existing) smart account for a given owner + salt.
    function createAccount(address owner, uint256 salt) external returns (SimpleSmartAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) {
            return SimpleSmartAccount(payable(predicted));
        }
        account = new SimpleSmartAccount{salt: bytes32(salt)}(owner, entryPoint);
        emit AccountCreated(address(account), owner, salt);
    }

    /// @notice Predict the address of a smart account before deployment.
    ///         Use this to KYC-register the account address in IdentityRegistry
    ///         before the SME deploys it.
    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(SimpleSmartAccount).creationCode,
                abi.encode(owner, entryPoint)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            bytes32(salt),
            bytecodeHash
        )))));
    }
}
