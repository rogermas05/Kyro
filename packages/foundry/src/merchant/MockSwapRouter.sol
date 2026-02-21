// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PriceOracle.sol";

/// @title MockSwapRouter
/// @notice Simulates a DEX swap for testnet demos.
///         Conversion rate is sourced from the on-chain PriceOracle.
///         Reserves must be pre-funded by admin before swaps can execute.
///
/// Real upgrade path: replace with a call to Uniswap V3 / Curve or any
/// DEX available on ADI mainnet — the ADIPayRouter interface is unchanged.
contract MockSwapRouter is Ownable {
    using SafeERC20 for IERC20;

    PriceOracle public immutable oracle;

    event Swapped(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );
    event ReserveDeposited(address indexed token, uint256 amount);
    event ReserveWithdrawn(address indexed token, uint256 amount);

    constructor(address _oracle, address owner_) Ownable(owner_) {
        oracle = PriceOracle(_oracle);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Pre-fund swap reserves. Admin must have approved this contract.
    function depositReserves(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveDeposited(token, amount);
    }

    /// @notice Withdraw reserves (e.g., to recycle testnet tokens).
    function withdrawReserves(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
        emit ReserveWithdrawn(token, amount);
    }

    // ── Core ──────────────────────────────────────────────────────────────────

    /// @notice Swap tokenIn for tokenOut at oracle rates.
    ///         Caller must have approved this contract for `amountIn` of `tokenIn`.
    /// @param tokenIn   Input ERC-20 token.
    /// @param tokenOut  Output ERC-20 token.
    /// @param amountIn  Amount of tokenIn to swap (wei).
    /// @return amountOut Amount of tokenOut sent to `recipient`.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient
    ) external returns (uint256 amountOut) {
        require(tokenIn != tokenOut, "SwapRouter: identical tokens");
        require(amountIn > 0, "SwapRouter: zero amountIn");

        // Rate: token-wei per 1e18 AED
        uint256 rateIn  = oracle.getRate(tokenIn);
        uint256 rateOut = oracle.getRate(tokenOut);

        // Cross-multiply through AED:
        //   amountIn tokenIn → amountIn / rateIn AED → amountOut = (amountIn / rateIn) * rateOut
        //   amountOut = amountIn * rateOut / rateIn
        amountOut = amountIn * rateOut / rateIn;
        require(amountOut > 0, "SwapRouter: zero amountOut");

        uint256 reserves = IERC20(tokenOut).balanceOf(address(this));
        require(reserves >= amountOut, "SwapRouter: insufficient reserves");

        // Pull input
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Push output
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    /// @notice Preview a swap without executing it.
    function previewSwap(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        uint256 rateIn  = oracle.getRate(tokenIn);
        uint256 rateOut = oracle.getRate(tokenOut);
        amountOut = amountIn * rateOut / rateIn;
    }
}
