// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../identity/IdentityRegistry.sol";

/// @title SeniorToken ($S-Debt)
/// @notice Represents the senior (80%) tranche of a tokenized invoice.
///         Fixed 6% yield. Priority repayment. Targeted at banks.
///         Transfers restricted to KYC-verified wallets.
contract SeniorToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IdentityRegistry public immutable identityRegistry;

    event ComplianceBlocked(address indexed from, address indexed to);

    constructor(address admin, address _identityRegistry)
        ERC20("ADI Senior Debt Token", "S-DEBT")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    /// @dev Compliance hook: block transfers to unverified wallets.
    ///      Mints (from == 0) and burns (to == 0) bypass the check.
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(identityRegistry.isVerified(to), "SeniorToken: recipient not KYC verified");
        }
        super._update(from, to, amount);
    }
}
