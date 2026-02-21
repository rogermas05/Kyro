// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title TrustedIssuersRegistry
/// @notice Whitelist of approved KYC/KYB providers whose claims are accepted.
contract TrustedIssuersRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    mapping(address => bool) private _trustedIssuers;
    address[] private _issuerList;

    event TrustedIssuerAdded(address indexed issuer);
    event TrustedIssuerRemoved(address indexed issuer);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function addTrustedIssuer(address issuer) external onlyRole(ADMIN_ROLE) {
        require(!_trustedIssuers[issuer], "Already trusted");
        _trustedIssuers[issuer] = true;
        _issuerList.push(issuer);
        emit TrustedIssuerAdded(issuer);
    }

    function removeTrustedIssuer(address issuer) external onlyRole(ADMIN_ROLE) {
        require(_trustedIssuers[issuer], "Not a trusted issuer");
        _trustedIssuers[issuer] = false;
        for (uint256 i = 0; i < _issuerList.length; i++) {
            if (_issuerList[i] == issuer) {
                _issuerList[i] = _issuerList[_issuerList.length - 1];
                _issuerList.pop();
                break;
            }
        }
        emit TrustedIssuerRemoved(issuer);
    }

    function isTrustedIssuer(address issuer) external view returns (bool) {
        return _trustedIssuers[issuer];
    }

    function getTrustedIssuers() external view returns (address[] memory) {
        return _issuerList;
    }
}
