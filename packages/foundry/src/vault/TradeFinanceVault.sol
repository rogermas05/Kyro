// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../identity/IdentityRegistry.sol";
import "../asset/SeniorToken.sol";
import "../asset/InvoiceOrchestrator.sol";

/// @title TradeFinanceVault
/// @notice ERC-4626 vault accepting DDSC deposits from KYC'd institutions.
///
/// How yield works (ERC-4626 math does the heavy lifting):
///   - Institutions deposit DDSC → receive vault shares at current price.
///   - Vault operator calls purchaseSeniorTranche() → vault sends DDSC to the
///     SME, receives S-DEBT tokens (valued at par, 1 S-DEBT = 1 DDSC).
///     totalAssets() stays the same (DDSC down, S-DEBT up equally).
///   - When the invoice is settled, the Orchestrator burns S-DEBT from this
///     vault and deposits DDSC (principal + interest) in return.
///     totalAssets() increases by the interest → share price rises automatically.
///   - Institution redeems shares at the higher price, receiving principal + yield.
contract TradeFinanceVault is ERC4626, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IdentityRegistry    public immutable identityRegistry;
    SeniorToken         public immutable seniorToken;
    InvoiceOrchestrator public orchestrator; // set after deploy

    event TranchesPurchased(bytes32 indexed invoiceId, address indexed sme, uint256 ddscPaid);

    constructor(
        address _ddsc,
        address admin,
        address _identityRegistry,
        address _seniorToken
    )
        ERC4626(IERC20(_ddsc))
        ERC20("ADI Trade Finance Vault Share", "ADI-VAULT")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        identityRegistry = IdentityRegistry(_identityRegistry);
        seniorToken      = SeniorToken(_seniorToken);
    }

    /// @notice Wire up the orchestrator after both contracts are deployed.
    function setOrchestrator(address _orchestrator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(orchestrator) == address(0), "Orchestrator already set");
        orchestrator = InvoiceOrchestrator(_orchestrator);
    }

    // ── ERC-4626 overrides ────────────────────────────────────────────────────

    /// @notice totalAssets = DDSC cash + S-DEBT held at par (1 S-DEBT = 1 DDSC).
    ///         When S-DEBT is burned on settlement and DDSC arrives, net change = interest.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + seniorToken.balanceOf(address(this));
    }

    /// @notice KYC gate on new deposits — receiver must be verified.
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        require(identityRegistry.isVerified(receiver), "Vault: receiver not KYC verified");
        return super.deposit(assets, receiver);
    }

    /// @notice KYC gate on share minting — receiver must be verified.
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        require(identityRegistry.isVerified(receiver), "Vault: receiver not KYC verified");
        return super.mint(shares, receiver);
    }

    /// @dev Compliance check on vault share transfers between wallets.
    ///      Mints and burns bypass this (handled at the deposit/withdraw entry points).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(identityRegistry.isVerified(to), "Vault: recipient not KYC verified");
        }
        super._update(from, to, value);
    }

    // ── Vault Operations ──────────────────────────────────────────────────────

    /// @notice Operator triggers purchase of a senior tranche from the Orchestrator.
    ///         Vault sends DDSC to the SME immediately; receives S-DEBT in return.
    function purchaseSeniorTranche(bytes32 invoiceId) external onlyRole(OPERATOR_ROLE) {
        require(address(orchestrator) != address(0), "Orchestrator not set");

        (address sme, uint256 seniorAmt,, bool purchased,) = orchestrator.invoices(invoiceId);
        require(sme != address(0), "Invoice not found");
        require(!purchased, "Already purchased");
        require(IERC20(asset()).balanceOf(address(this)) >= seniorAmt, "Insufficient DDSC liquidity");

        // Pull Senior tokens from Orchestrator into this vault
        orchestrator.purchaseSeniorTranche(invoiceId);

        // Deliver instant DDSC liquidity to the SME
        IERC20(asset()).safeTransfer(sme, seniorAmt);

        emit TranchesPurchased(invoiceId, sme, seniorAmt);
    }
}
