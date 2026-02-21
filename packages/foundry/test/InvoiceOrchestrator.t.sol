// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/identity/IdentityRegistry.sol";
import "../src/identity/ClaimTopicsRegistry.sol";
import "../src/identity/TrustedIssuersRegistry.sol";
import "../src/asset/InvoiceToken.sol";
import "../src/asset/SeniorToken.sol";
import "../src/asset/JuniorToken.sol";
import "../src/asset/InvoiceZKVerifier.sol";
import "../src/asset/InvoiceOrchestrator.sol";
import "../src/mocks/MockDDSC.sol";

contract InvoiceOrchestratorTest is Test {
    // ── Infrastructure ────────────────────────────────────────────────────────
    ClaimTopicsRegistry   public claimTopics;
    TrustedIssuersRegistry public trustedIssuers;
    IdentityRegistry      public registry;
    InvoiceToken          public invoiceToken;
    SeniorToken           public seniorToken;
    JuniorToken           public juniorToken;
    InvoiceZKVerifier     public verifier;
    InvoiceOrchestrator   public orchestrator;
    MockDDSC              public ddsc;

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin       = makeAddr("admin");
    address sme         = makeAddr("sme");
    address institution = makeAddr("institution");  // acts as vault for testing
    address stranger    = makeAddr("stranger");

    // Oracle signing key — used to generate mock ZK proofs
    uint256 oraclePrivKey = 0xBEEF;
    address oracle;

    // ── Invoice params ────────────────────────────────────────────────────────
    bytes32 invoiceId   = keccak256("INV-001");
    uint256 faceValue   = 1000e18; // 1000 DDSC
    uint64  dueDate;
    bytes32 docHash     = keccak256("shipping-docs");
    address counterparty = makeAddr("buyer");

    function setUp() public {
        oracle = vm.addr(oraclePrivKey);
        dueDate = uint64(block.timestamp + 30 days);

        vm.startPrank(admin);

        // Identity layer
        claimTopics   = new ClaimTopicsRegistry(admin);
        trustedIssuers = new TrustedIssuersRegistry(admin);
        registry      = new IdentityRegistry(admin, address(claimTopics), address(trustedIssuers));

        // Tokens
        invoiceToken = new InvoiceToken(admin, address(registry));
        seniorToken  = new SeniorToken(admin, address(registry));
        juniorToken  = new JuniorToken(admin, address(registry));

        // Verifier + DDSC
        verifier = new InvoiceZKVerifier(oracle, admin);
        ddsc     = new MockDDSC(admin);

        // Orchestrator
        orchestrator = new InvoiceOrchestrator(
            admin,
            address(registry),
            address(invoiceToken),
            address(seniorToken),
            address(juniorToken),
            address(verifier),
            address(ddsc)
        );

        // Grant orchestrator minting rights over all tokens
        invoiceToken.grantRole(invoiceToken.MINTER_ROLE(), address(orchestrator));
        seniorToken.grantRole(seniorToken.MINTER_ROLE(), address(orchestrator));
        juniorToken.grantRole(juniorToken.MINTER_ROLE(), address(orchestrator));

        // Use institution as a stand-in vault
        orchestrator.setVault(institution);

        // KYC both actors
        registry.registerIdentity(sme, 784);
        registry.setKycStatus(sme, true);
        registry.registerIdentity(institution, 784);
        registry.setKycStatus(institution, true);

        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _makeProof(bytes32 _invoiceId, uint256 _faceValue, uint64 _dueDate, bytes32 _docHash)
        internal
        view
        returns (bytes memory)
    {
        bytes32 messageHash = keccak256(abi.encodePacked(_invoiceId, _faceValue, _dueDate, _docHash));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _mintInvoice() internal {
        bytes memory proof = _makeProof(invoiceId, faceValue, dueDate, docHash);
        vm.prank(sme);
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, proof);
    }

    // ── InvoiceZKVerifier ─────────────────────────────────────────────────────

    function test_VerifierAcceptsValidProof() public view {
        bytes memory proof = _makeProof(invoiceId, faceValue, dueDate, docHash);
        assertTrue(verifier.verifyProof(proof, invoiceId, faceValue, dueDate, docHash));
    }

    function test_VerifierRejectsWrongSigner() public view {
        bytes memory badProof = _makeProof(invoiceId, faceValue, dueDate, docHash);
        // Tamper with faceValue — signature no longer matches
        assertFalse(verifier.verifyProof(badProof, invoiceId, faceValue + 1, dueDate, docHash));
    }

    // ── mintInvoice ───────────────────────────────────────────────────────────

    function test_MintInvoiceMintsCorrectTranches() public {
        _mintInvoice();

        uint256 seniorAmt = faceValue * 8000 / 10000; // 80%
        uint256 juniorAmt = faceValue * 2000 / 10000; // 20%

        // Senior held in Orchestrator pending vault purchase
        assertEq(seniorToken.balanceOf(address(orchestrator)), seniorAmt);
        // Junior goes to SME
        assertEq(juniorToken.balanceOf(sme), juniorAmt);
        // Invoice NFT held in Orchestrator
        assertEq(invoiceToken.balanceOf(address(orchestrator)), 1);
    }

    function test_MintInvoiceRecordsMetadata() public {
        _mintInvoice();
        InvoiceToken.InvoiceMetadata memory meta = invoiceToken.getMetadata(invoiceId);
        assertEq(meta.faceValue, faceValue);
        assertEq(meta.dueDate, dueDate);
        assertEq(meta.documentHash, docHash);
        assertEq(meta.sme, sme);
    }

    function test_MintRevertsIfNotKYC() public {
        bytes memory proof = _makeProof(invoiceId, faceValue, dueDate, docHash);
        vm.prank(stranger); // not registered
        vm.expectRevert("Orchestrator: SME not KYC verified");
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, proof);
    }

    function test_MintRevertsWithBadProof() public {
        // All-zero bytes is an invalid ECDSA signature.
        // ECDSA.recover reverts with ECDSAInvalidSignature before our require fires —
        // either way the call reverts, which is the intended behavior.
        bytes memory badProof = new bytes(65);
        vm.prank(sme);
        vm.expectRevert();
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, badProof);
    }

    function test_MintRevertsIfDuplicateInvoice() public {
        _mintInvoice();
        vm.prank(sme);
        vm.expectRevert("Invoice already exists");
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, _makeProof(invoiceId, faceValue, dueDate, docHash));
    }

    // ── purchaseSeniorTranche ─────────────────────────────────────────────────

    function test_PurchaseSeniorTransfersTokensToVault() public {
        _mintInvoice();

        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        uint256 seniorAmt = faceValue * 8000 / 10000;
        assertEq(seniorToken.balanceOf(institution), seniorAmt);
        assertEq(seniorToken.balanceOf(address(orchestrator)), 0);
    }

    function test_PurchaseSeniorSetsStateToActive() public {
        _mintInvoice();

        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        InvoiceToken.InvoiceMetadata memory meta = invoiceToken.getMetadata(invoiceId);
        assertEq(uint8(meta.state), uint8(InvoiceToken.InvoiceState.ACTIVE));
    }

    function test_PurchaseSeniorRevertsIfNotVault() public {
        _mintInvoice();
        vm.prank(stranger);
        vm.expectRevert();
        orchestrator.purchaseSeniorTranche(invoiceId);
    }

    function test_PurchaseSeniorRevertsIfAlreadyPurchased() public {
        _mintInvoice();
        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        vm.prank(institution);
        vm.expectRevert("Already purchased");
        orchestrator.purchaseSeniorTranche(invoiceId);
    }

    // ── settleInvoice ─────────────────────────────────────────────────────────

    function test_SettleInvoiceBurnsTokensAndForwardsDDSC() public {
        _mintInvoice();

        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        // Settlement oracle sends DDSC into Orchestrator (simulates real-world payment)
        uint256 repayment = 1060e18; // principal + 6% yield
        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);

        uint256 vaultDdscBefore = ddsc.balanceOf(institution);

        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        // Tokens burned
        assertEq(seniorToken.balanceOf(institution), 0);
        assertEq(juniorToken.balanceOf(sme), 0);
        assertEq(invoiceToken.balanceOf(address(orchestrator)), 0);

        // DDSC forwarded to vault
        assertEq(ddsc.balanceOf(institution), vaultDdscBefore + repayment);
    }

    function test_SettleRevertsIfAlreadySettled() public {
        _mintInvoice();
        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);
        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        vm.prank(admin);
        vm.expectRevert("Already settled");
        orchestrator.settleInvoice(invoiceId);
    }

    // ── defaultInvoice ────────────────────────────────────────────────────────

    function test_DefaultWipesJuniorAndPartialSenior() public {
        _mintInvoice();
        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        // Only 50% recovered
        uint256 recovered = 500e18;
        vm.prank(admin);
        ddsc.mint(address(orchestrator), recovered);

        vm.prank(admin);
        orchestrator.defaultInvoice(invoiceId);

        // Junior wiped
        assertEq(juniorToken.balanceOf(sme), 0);
        // Senior burned
        assertEq(seniorToken.balanceOf(institution), 0);
        // Vault got the partial recovery
        assertEq(ddsc.balanceOf(institution), recovered);
    }

    function test_DefaultWithZeroRecovery() public {
        _mintInvoice();
        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        // No DDSC recovered at all
        vm.prank(admin);
        orchestrator.defaultInvoice(invoiceId);

        assertEq(seniorToken.balanceOf(institution), 0);
        assertEq(juniorToken.balanceOf(sme), 0);
        assertEq(ddsc.balanceOf(institution), 0);
    }

    // ── Compliance: SeniorToken & JuniorToken transfers ───────────────────────

    function test_SeniorTransferToUnverifiedReverts() public {
        _mintInvoice();
        vm.prank(institution);
        orchestrator.purchaseSeniorTranche(invoiceId);

        uint256 seniorAmt = faceValue * 8000 / 10000;
        vm.prank(institution);
        vm.expectRevert("SeniorToken: recipient not KYC verified");
        seniorToken.transfer(stranger, seniorAmt);
    }

    function test_JuniorTransferToUnverifiedReverts() public {
        _mintInvoice();

        uint256 juniorAmt = faceValue * 2000 / 10000;
        vm.prank(sme);
        vm.expectRevert("JuniorToken: recipient not KYC verified");
        juniorToken.transfer(stranger, juniorAmt);
    }
}
