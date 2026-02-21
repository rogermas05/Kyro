// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PriceOracle
/// @notice Mock on-chain price oracle for the ADI Merchant Checkout.
///
/// Rate definition:
///   getRate(token) returns how many token-wei are worth 1 AED-wei (1e18).
///
/// Examples (18-decimal tokens):
///   DDSC  → 1e18  (1 DDSC = 1 AED, pegged)
///   mADI  → 5e17  (1 ADI  = 2 AED, so 1 AED = 0.5 ADI)
///   USDC  → 9e17  (1 USDC ≈ 0.9 AED assumed)
///
/// So for a 500 AED purchase paid in mADI:
///   tokenAmount = 500e18 * 5e17 / 1e18 = 250e18 (250 ADI)
///
/// Real upgrade path: replace setRate() with a Chainlink aggregator read or
/// an on-chain DEX TWAP — the interface stays identical.
contract PriceOracle is Ownable {
    uint256 public constant AED_DECIMALS = 1e18;

    // token address → token-wei per 1 AED-wei
    mapping(address => uint256) private _rates;

    event RateUpdated(address indexed token, uint256 newRate);

    constructor(address owner_) Ownable(owner_) {}

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Set the exchange rate for a token.
    /// @param token   ERC-20 token address.
    /// @param rate    Token-wei per 1e18 AED-wei. E.g. 5e17 means 1 AED = 0.5 token.
    function setRate(address token, uint256 rate) external onlyOwner {
        require(rate > 0, "Oracle: rate must be > 0");
        _rates[token] = rate;
        emit RateUpdated(token, rate);
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /// @notice Returns token-wei per 1 AED (1e18).
    function getRate(address token) external view returns (uint256) {
        uint256 rate = _rates[token];
        require(rate > 0, "Oracle: no rate for token");
        return rate;
    }

    /// @notice Convert a fiat amount (AED, 18 decimals) to token units.
    /// @param fiatAmount  AED amount scaled by 1e18. E.g. 500 AED = 500e18.
    /// @param token       The token the payer will use.
    function fiatToToken(uint256 fiatAmount, address token) external view returns (uint256) {
        uint256 rate = _rates[token];
        require(rate > 0, "Oracle: no rate for token");
        return fiatAmount * rate / AED_DECIMALS;
    }
}
