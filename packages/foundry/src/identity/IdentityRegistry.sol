// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ClaimTopicsRegistry.sol";
import "./TrustedIssuersRegistry.sol";

/// @title IdentityRegistry
/// @notice Core compliance gating layer. Maps wallet addresses to KYC records.
///         Every transfer-restricted contract calls isVerified() before executing.
contract IdentityRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant COMPLIANCE_AGENT_ROLE = keccak256("COMPLIANCE_AGENT_ROLE");

    struct IdentityRecord {
        bool registered;
        bool kycApproved;
        uint16 country; // ISO 3166-1 numeric country code
    }

    mapping(address => IdentityRecord) private _identities;

    ClaimTopicsRegistry public claimTopicsRegistry;
    TrustedIssuersRegistry public trustedIssuersRegistry;

    event IdentityRegistered(address indexed wallet, uint16 country);
    event IdentityRevoked(address indexed wallet);
    event KYCStatusUpdated(address indexed wallet, bool approved);

    constructor(address admin, address _claimTopicsRegistry, address _trustedIssuersRegistry) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_AGENT_ROLE, admin);
        claimTopicsRegistry = ClaimTopicsRegistry(_claimTopicsRegistry);
        trustedIssuersRegistry = TrustedIssuersRegistry(_trustedIssuersRegistry);
    }

    /// @notice Register a wallet with a country code. KYC starts as not approved.
    function registerIdentity(address wallet, uint16 country)
        external
        onlyRole(COMPLIANCE_AGENT_ROLE)
    {
        require(!_identities[wallet].registered, "Already registered");
        _identities[wallet] = IdentityRecord({registered: true, kycApproved: false, country: country});
        emit IdentityRegistered(wallet, country);
    }

    /// @notice Approve or revoke KYC for a registered identity.
    function setKycStatus(address wallet, bool approved) external onlyRole(COMPLIANCE_AGENT_ROLE) {
        require(_identities[wallet].registered, "Not registered");
        _identities[wallet].kycApproved = approved;
        emit KYCStatusUpdated(wallet, approved);
    }

    /// @notice Remove an identity from the registry (e.g., sanctions screening hit).
    function revokeIdentity(address wallet) external onlyRole(COMPLIANCE_AGENT_ROLE) {
        require(_identities[wallet].registered, "Not registered");
        delete _identities[wallet];
        emit IdentityRevoked(wallet);
    }

    /// @notice Returns true if the wallet is registered and KYC-approved.
    function isVerified(address wallet) external view returns (bool) {
        IdentityRecord storage record = _identities[wallet];
        return record.registered && record.kycApproved;
    }

    function getIdentity(address wallet) external view returns (IdentityRecord memory) {
        return _identities[wallet];
    }
}
