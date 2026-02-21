// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../identity/IdentityRegistry.sol";

/// @title JuniorToken ($J-Debt)
/// @notice Represents the junior (20%) tranche of a tokenized invoice.
///         Variable yield (leftover profit after senior). First to absorb losses on default.
///         Targeted at hedge funds. Transfers restricted to KYC-verified wallets.
contract JuniorToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IdentityRegistry public immutable identityRegistry;

    constructor(address admin, address _identityRegistry)
        ERC20("ADI Junior Debt Token", "J-DEBT")
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
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(identityRegistry.isVerified(to), "JuniorToken: recipient not KYC verified");
        }
        super._update(from, to, amount);
    }
}
