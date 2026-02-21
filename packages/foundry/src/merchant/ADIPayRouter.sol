// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PriceOracle.sol";
import "./MockSwapRouter.sol";

/// @title ADIPayRouter
/// @notice Merchant checkout entry point — the on-chain half of the ADIPay widget.
///
/// Flow:
///   1. Widget reads fiatAmount + currency from the merchant's config.
///   2. Widget calls oracle.fiatToToken(fiatAmount, tokenIn) to display token cost.
///   3. Customer approves ADIPayRouter for tokenIn.
///   4. Customer (or widget script) calls checkout().
///   5. Router converts to targetToken if needed, sends to merchant.
///   6. Emits CheckoutCompleted for the auditor dashboard and receipt generation.
///
/// The QR flow works identically — the QR encodes the checkout() calldata,
/// which the mobile wallet signs and submits.
contract ADIPayRouter is Ownable {
    using SafeERC20 for IERC20;

    PriceOracle     public immutable oracle;
    MockSwapRouter  public immutable swapRouter;

    uint256 public constant AED_DECIMALS = 1e18;

    // Optional protocol fee in basis points (default: 0)
    uint256 public feeBps;
    address public feeRecipient;

    event CheckoutCompleted(
        address indexed merchant,
        address indexed payer,
        uint256 fiatAmount,        // AED scaled by 1e18
        address tokenIn,
        uint256 tokenInAmount,
        address targetToken,
        uint256 merchantReceived
    );
    event FeeUpdated(uint256 feeBps, address recipient);

    constructor(
        address _oracle,
        address _swapRouter,
        address owner_
    ) Ownable(owner_) {
        oracle     = PriceOracle(_oracle);
        swapRouter = MockSwapRouter(_swapRouter);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setFee(uint256 _feeBps, address _recipient) external onlyOwner {
        require(_feeBps <= 200, "Fee: max 2%");
        feeBps       = _feeBps;
        feeRecipient = _recipient;
        emit FeeUpdated(_feeBps, _recipient);
    }

    // ── Checkout ──────────────────────────────────────────────────────────────

    /// @notice Execute a merchant checkout.
    /// @param merchant     Merchant wallet — receives targetToken.
    /// @param fiatAmount   Purchase price in AED (18 decimals). E.g. 500 AED = 500e18.
    /// @param tokenIn      Token the customer is paying with.
    /// @param targetToken  Token the merchant wants to receive.
    function checkout(
        address merchant,
        uint256 fiatAmount,
        address tokenIn,
        address targetToken
    ) external {
        require(merchant != address(0), "PayRouter: zero merchant");
        require(fiatAmount > 0,         "PayRouter: zero fiatAmount");

        // ── 1. Calculate how many tokenIn units = fiatAmount AED ─────────────
        uint256 tokenInAmount = oracle.fiatToToken(fiatAmount, tokenIn);
        require(tokenInAmount > 0, "PayRouter: zero token amount");

        // ── 2. Pull tokenIn from payer ────────────────────────────────────────
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenInAmount);

        // ── 3. Swap if tokenIn != targetToken ─────────────────────────────────
        uint256 swappedAmount;
        if (tokenIn == targetToken) {
            swappedAmount = tokenInAmount;
        } else {
            IERC20(tokenIn).forceApprove(address(swapRouter), tokenInAmount);
            swappedAmount = swapRouter.swap(tokenIn, targetToken, tokenInAmount, address(this));
        }

        // ── 4. Deduct optional protocol fee ───────────────────────────────────
        uint256 feeAmount = swappedAmount * feeBps / 10_000;
        uint256 merchantAmount = swappedAmount - feeAmount;

        if (feeAmount > 0 && feeRecipient != address(0)) {
            IERC20(targetToken).safeTransfer(feeRecipient, feeAmount);
        }

        // ── 5. Send targetToken to merchant ───────────────────────────────────
        IERC20(targetToken).safeTransfer(merchant, merchantAmount);

        emit CheckoutCompleted(
            merchant,
            msg.sender,
            fiatAmount,
            tokenIn,
            tokenInAmount,
            targetToken,
            merchantAmount
        );
    }

    /// @notice Preview a checkout — returns how many tokenIn units will be charged.
    function previewCheckout(uint256 fiatAmount, address tokenIn)
        external
        view
        returns (uint256 tokenInAmount)
    {
        return oracle.fiatToToken(fiatAmount, tokenIn);
    }
}
