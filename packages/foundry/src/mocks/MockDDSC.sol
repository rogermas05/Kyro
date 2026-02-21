// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockDDSC
/// @notice Testnet-only mintable UAE Dirham stablecoin. 1 DDSC = 1 AED.
contract MockDDSC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Mock UAE Dirham Stablecoin", "DDSC") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
