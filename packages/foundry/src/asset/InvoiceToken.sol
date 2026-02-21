// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../identity/IdentityRegistry.sol";

/// @title InvoiceToken
/// @notice ERC-721 representing a unique real-world invoice. One NFT per invoice.
///         Held in the Orchestrator as escrow for the invoice's lifetime.
///         Burned upon settlement or default.
contract InvoiceToken is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    enum InvoiceState { PENDING, ACTIVE, SETTLED, DEFAULTED }

    struct InvoiceMetadata {
        uint256 faceValue;   // DDSC amount (18 decimals)
        uint64  dueDate;     // Unix timestamp
        bytes32 documentHash;// Keccak256 of off-chain invoice document
        address counterparty;// Buyer / debtor address (off-chain reference)
        address sme;         // Invoice originator
        InvoiceState state;
    }

    IdentityRegistry public immutable identityRegistry;

    // invoiceId (bytes32) → token ID (uint256)
    mapping(bytes32 => uint256) public invoiceIdToTokenId;
    mapping(uint256 => bytes32) public tokenIdToInvoiceId;
    mapping(uint256 => InvoiceMetadata) public metadata;

    uint256 private _nextTokenId;

    event InvoiceTokenMinted(bytes32 indexed invoiceId, uint256 tokenId, address sme, uint256 faceValue);
    event InvoiceStateChanged(bytes32 indexed invoiceId, InvoiceState newState);

    constructor(address admin, address _identityRegistry)
        ERC721("ADI Invoice Token", "ADI-INV")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    function mint(
        bytes32 invoiceId,
        uint256 faceValue,
        uint64 dueDate,
        bytes32 documentHash,
        address counterparty,
        address sme,
        address recipient
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        require(invoiceIdToTokenId[invoiceId] == 0, "Invoice already minted");
        require(faceValue > 0, "Face value must be > 0");
        require(dueDate > block.timestamp, "Due date must be in the future");

        tokenId = ++_nextTokenId;
        invoiceIdToTokenId[invoiceId] = tokenId;
        tokenIdToInvoiceId[tokenId] = invoiceId;
        metadata[tokenId] = InvoiceMetadata({
            faceValue: faceValue,
            dueDate: dueDate,
            documentHash: documentHash,
            counterparty: counterparty,
            sme: sme,
            state: InvoiceState.PENDING
        });

        _mint(recipient, tokenId);
        emit InvoiceTokenMinted(invoiceId, tokenId, sme, faceValue);
    }

    function burn(uint256 tokenId) external onlyRole(MINTER_ROLE) {
        _burn(tokenId);
    }

    function setState(bytes32 invoiceId, InvoiceState newState) external onlyRole(MINTER_ROLE) {
        uint256 tokenId = invoiceIdToTokenId[invoiceId];
        require(tokenId != 0, "Invoice not found");
        metadata[tokenId].state = newState;
        emit InvoiceStateChanged(invoiceId, newState);
    }

    function getMetadata(bytes32 invoiceId) external view returns (InvoiceMetadata memory) {
        uint256 tokenId = invoiceIdToTokenId[invoiceId];
        require(tokenId != 0, "Invoice not found");
        return metadata[tokenId];
    }

    // Restrict transfers: only MINTER_ROLE (Orchestrator) can move tokens.
    // Invoice NFTs stay in Orchestrator escrow; they are never user-traded.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow mints (from == 0) and burns (to == 0) freely.
        // For any real transfer, require the caller to hold MINTER_ROLE.
        if (from != address(0) && to != address(0)) {
            require(hasRole(MINTER_ROLE, msg.sender), "InvoiceToken: transfer restricted");
        }
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
