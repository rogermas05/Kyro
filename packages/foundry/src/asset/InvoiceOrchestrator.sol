// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../identity/IdentityRegistry.sol";
import "./InvoiceToken.sol";
import "./SeniorToken.sol";
import "./JuniorToken.sol";
import "./InvoiceZKVerifier.sol";

/// @title InvoiceOrchestrator
/// @notice Manages the full lifecycle of a tokenized invoice:
///         mint → (vault purchases senior tranche) → settle | default
///
/// Flow:
///   1. SME calls mintInvoice() → InvoiceToken minted to this contract,
///      SeniorTokens minted here (pending vault purchase), JuniorTokens to SME.
///   2. Vault calls purchaseSeniorTranche() → Senior tokens transferred to vault,
///      vault sends DDSC to SME separately.
///   3. On repayment, SETTLEMENT_ROLE calls settleInvoice() → burns everything,
///      forwards DDSC to vault.
///   4. On default, SETTLEMENT_ROLE calls defaultInvoice() → Junior wiped first,
///      Senior receives partial recovery.
contract InvoiceOrchestrator is AccessControl {
    using SafeERC20 for IERC20;
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    uint256 public constant SENIOR_BPS = 8000; // 80%
    uint256 public constant JUNIOR_BPS = 2000; // 20%
    uint256 public constant BPS_DENOM  = 10000;

    IdentityRegistry  public immutable identityRegistry;
    InvoiceToken      public immutable invoiceToken;
    SeniorToken       public immutable seniorToken;
    JuniorToken       public immutable juniorToken;
    InvoiceZKVerifier public immutable zkVerifier;
    IERC20            public immutable ddsc;

    // vault address — set once during configuration
    address public vault;

    struct InvoiceRecord {
        address sme;
        uint256 seniorAmount; // S-DEBT minted
        uint256 juniorAmount; // J-DEBT minted
        bool    seniorPurchased;
        bool    settled;
    }

    mapping(bytes32 => InvoiceRecord) public invoices;

    event InvoiceMinted(
        bytes32 indexed invoiceId,
        address indexed sme,
        uint256 faceValue,
        uint256 seniorAmount,
        uint256 juniorAmount
    );
    event SeniorTranchePurchased(bytes32 indexed invoiceId, address indexed buyer, uint256 amount);
    event InvoiceSettled(bytes32 indexed invoiceId, uint256 ddscRepaid);
    event InvoiceDefaulted(bytes32 indexed invoiceId, uint256 recoveredAmount);

    constructor(
        address admin,
        address _identityRegistry,
        address _invoiceToken,
        address _seniorToken,
        address _juniorToken,
        address _zkVerifier,
        address _ddsc
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, admin);
        identityRegistry = IdentityRegistry(_identityRegistry);
        invoiceToken     = InvoiceToken(_invoiceToken);
        seniorToken      = SeniorToken(_seniorToken);
        juniorToken      = JuniorToken(_juniorToken);
        zkVerifier       = InvoiceZKVerifier(_zkVerifier);
        ddsc             = IERC20(_ddsc);
    }

    function setVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(vault == address(0), "Vault already set");
        vault = _vault;
        _grantRole(VAULT_ROLE, _vault);
    }

    // ── Core Actions ─────────────────────────────────────────────────────────

    /// @notice SME originates a new invoice. ZK proof attests off-chain validity.
    function mintInvoice(
        bytes32 invoiceId,
        uint256 faceValue,
        uint64  dueDate,
        bytes32 documentHash,
        address counterparty,
        bytes calldata zkProof
    ) external {
        require(identityRegistry.isVerified(msg.sender), "Orchestrator: SME not KYC verified");
        require(invoices[invoiceId].sme == address(0), "Invoice already exists");
        require(
            zkVerifier.verifyProof(zkProof, invoiceId, faceValue, dueDate, documentHash),
            "Orchestrator: invalid ZK proof"
        );

        uint256 seniorAmt = faceValue * SENIOR_BPS / BPS_DENOM;
        uint256 juniorAmt = faceValue * JUNIOR_BPS / BPS_DENOM;

        // Mint invoice NFT to this contract (escrow)
        invoiceToken.mint(invoiceId, faceValue, dueDate, documentHash, counterparty, msg.sender, address(this));

        // Senior tokens held here until vault purchases
        seniorToken.mint(address(this), seniorAmt);

        // Junior tokens go directly to SME
        juniorToken.mint(msg.sender, juniorAmt);

        invoices[invoiceId] = InvoiceRecord({
            sme: msg.sender,
            seniorAmount: seniorAmt,
            juniorAmount: juniorAmt,
            seniorPurchased: false,
            settled: false
        });

        emit InvoiceMinted(invoiceId, msg.sender, faceValue, seniorAmt, juniorAmt);
    }

    /// @notice Vault calls this to acquire the senior tranche.
    ///         Vault handles DDSC transfer to SME independently.
    function purchaseSeniorTranche(bytes32 invoiceId) external onlyRole(VAULT_ROLE) {
        InvoiceRecord storage rec = invoices[invoiceId];
        require(rec.sme != address(0), "Invoice not found");
        require(!rec.seniorPurchased, "Already purchased");
        require(!rec.settled, "Invoice already settled");

        rec.seniorPurchased = true;
        invoiceToken.setState(invoiceId, InvoiceToken.InvoiceState.ACTIVE);

        // Transfer senior tokens to vault
        IERC20(address(seniorToken)).safeTransfer(vault, rec.seniorAmount);

        emit SeniorTranchePurchased(invoiceId, vault, rec.seniorAmount);
    }

    /// @notice Called by settlement oracle when the invoice is repaid in full.
    ///         DDSC must be transferred into this contract before calling.
    function settleInvoice(bytes32 invoiceId) external onlyRole(SETTLEMENT_ROLE) {
        InvoiceRecord storage rec = invoices[invoiceId];
        require(rec.sme != address(0), "Invoice not found");
        require(!rec.settled, "Already settled");

        rec.settled = true;
        invoiceToken.setState(invoiceId, InvoiceToken.InvoiceState.SETTLED);

        uint256 tokenId = invoiceToken.invoiceIdToTokenId(invoiceId);

        // Burn tranche tokens
        seniorToken.burn(vault, rec.seniorAmount);
        juniorToken.burn(rec.sme, rec.juniorAmount);

        // Burn invoice NFT
        invoiceToken.burn(tokenId);

        // Forward DDSC to vault (principal + interest)
        uint256 balance = ddsc.balanceOf(address(this));
        if (balance > 0) {
            ddsc.safeTransfer(vault, balance);
        }

        emit InvoiceSettled(invoiceId, balance);
    }

    /// @notice Called when invoice defaults. Junior absorbs first loss.
    ///         Pass in however much DDSC was recovered (can be 0).
    ///         DDSC must be transferred into this contract before calling.
    function defaultInvoice(bytes32 invoiceId) external onlyRole(SETTLEMENT_ROLE) {
        InvoiceRecord storage rec = invoices[invoiceId];
        require(rec.sme != address(0), "Invoice not found");
        require(!rec.settled, "Already settled");

        rec.settled = true;
        invoiceToken.setState(invoiceId, InvoiceToken.InvoiceState.DEFAULTED);

        uint256 tokenId = invoiceToken.invoiceIdToTokenId(invoiceId);
        uint256 recovered = ddsc.balanceOf(address(this));

        // Junior is wiped entirely
        juniorToken.burn(rec.sme, rec.juniorAmount);

        // Senior gets partial recovery (capped at what was owed)
        uint256 seniorRecovery = recovered > rec.seniorAmount ? rec.seniorAmount : recovered;
        if (seniorRecovery > 0) {
            ddsc.safeTransfer(vault, seniorRecovery);
        }

        // Burn senior tokens held by vault
        seniorToken.burn(vault, rec.seniorAmount);

        // Burn invoice NFT
        invoiceToken.burn(tokenId);

        emit InvoiceDefaulted(invoiceId, recovered);
    }
}
