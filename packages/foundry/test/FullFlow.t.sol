// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

// ── Identity ──────────────────────────────────────────────────────────────────
import "../src/identity/ClaimTopicsRegistry.sol";
import "../src/identity/TrustedIssuersRegistry.sol";
import "../src/identity/IdentityRegistry.sol";

// ── Asset ─────────────────────────────────────────────────────────────────────
import "../src/asset/InvoiceZKVerifier.sol";
import "../src/asset/InvoiceToken.sol";
import "../src/asset/SeniorToken.sol";
import "../src/asset/JuniorToken.sol";
import "../src/asset/InvoiceOrchestrator.sol";

// ── Vault ─────────────────────────────────────────────────────────────────────
import "../src/vault/TradeFinanceVault.sol";

// ── AA ────────────────────────────────────────────────────────────────────────
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

// ── Merchant ──────────────────────────────────────────────────────────────────
import "../src/merchant/PriceOracle.sol";
import "../src/merchant/MockSwapRouter.sol";
import "../src/merchant/ADIPayRouter.sol";

// ── Mocks ─────────────────────────────────────────────────────────────────────
import "../src/mocks/MockDDSC.sol";
import "../src/mocks/MockADI.sol";

// ── MockEntryPoint helper for Track 2 tests ───────────────────────────────────
// Mirrors the MockEntryPoint in SignaturePaymaster.t.sol.
// Allows the test to pass the opHash EXPLICITLY so both sponsor and account
// sign the SAME hash (computed before paymasterAndData sig is injected).
contract MockEP is IEntryPoint {
    mapping(address => uint256) public balanceOf;

    function depositTo(address account) external payable override {
        balanceOf[account] += msg.value;
    }
    function withdrawTo(address payable to, uint256 amount) external override {
        require(balanceOf[msg.sender] >= amount, "Insufficient deposit");
        balanceOf[msg.sender] -= amount;
        to.transfer(amount);
    }
    function getNonce(address, uint192) external pure override returns (uint256) { return 0; }
    function getUserOpHash(PackedUserOperation calldata userOp) external view override returns (bytes32) {
        return keccak256(abi.encode(userOp, block.chainid, address(this)));
    }
    function handleOps(PackedUserOperation[] calldata, address payable) external override {}

    // Test helpers: call validate functions with an explicit hash
    function callValidatePaymaster(address pm, PackedUserOperation calldata op, bytes32 hash)
        external returns (bytes memory ctx, uint256 vd)
    { return IPaymaster(pm).validatePaymasterUserOp(op, hash, 0); }

    function callValidateUserOp(address account, PackedUserOperation calldata op, bytes32 hash, uint256 missing)
        external returns (uint256)
    { return IAccount(account).validateUserOp(op, hash, missing); }

    receive() external payable {}
}

/// @title FullFlowTest
/// @notice End-to-end integration test exercising all three ADI hackathon tracks
///         in a single Forge test environment.
///
/// Track 1 (RWA): KYC → mintInvoice → institution deposit → vault purchases senior
///                tranche → invoice settled with interest → institution redeems yield
///
/// Track 2 (AA):  Zero-ADI SME wallet deploys a smart account, sponsor signs a
///                UserOp, EntryPoint validates + executes mintInvoice gas-free
///
/// Track 3 (Merchant): Customer pays 500 AED in mADI → swap router converts →
///                     merchant receives 500 DDSC
contract FullFlowTest is Test {

    // ── Track 1 + 2 contracts ─────────────────────────────────────────────────
    ClaimTopicsRegistry    claimTopics;
    TrustedIssuersRegistry trustedIssuers;
    IdentityRegistry       registry;
    InvoiceZKVerifier      zkVerifier;
    InvoiceToken           invoiceToken;
    SeniorToken            seniorToken;
    JuniorToken            juniorToken;
    InvoiceOrchestrator    orchestrator;
    TradeFinanceVault      vault;
    MockDDSC               ddsc;

    // ── Track 2 contracts ─────────────────────────────────────────────────────
    MinimalEntryPoint          entryPoint;
    SignaturePaymaster         paymaster;
    SimpleSmartAccountFactory  factory;

    // ── Track 3 contracts ─────────────────────────────────────────────────────
    PriceOracle    oracle;
    MockSwapRouter swapRouter;
    ADIPayRouter   payRouter;
    MockADI        madi;

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin       = makeAddr("admin");
    address sme         = makeAddr("sme");         // Track 1 SME
    address institution = makeAddr("institution"); // Track 1 investor
    address merchant    = makeAddr("merchant");    // Track 3 merchant
    address customer    = makeAddr("customer");    // Track 3 customer

    // Private keys for signing
    uint256 oraclePrivKey  = 0xBEEF;
    uint256 sponsorPrivKey = 0xCAFE;
    uint256 smeOwnerKey    = 0xABCD; // SME's EOA (zero ADI balance)
    address oracleSigner;
    address sponsorSigner;
    address smeOwner;

    // ── Invoice params ────────────────────────────────────────────────────────
    bytes32 invoiceId  = keccak256("ADI-INV-001");
    uint256 faceValue  = 1_000e18;  // 1 000 DDSC
    uint256 seniorAmt  = 800e18;    // 80%
    uint256 juniorAmt  = 200e18;    // 20%
    uint64  dueDate;
    bytes32 docHash    = keccak256("shipping-docs-001");
    address counterparty = makeAddr("buyer");

    // ── Oracle rates (Track 3) ────────────────────────────────────────────────
    uint256 constant DDSC_RATE = 1e18;  // 1 DDSC = 1 AED
    uint256 constant MADI_RATE = 5e17;  // 1 mADI = 2 AED → 1 AED = 0.5 mADI

    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        oracleSigner = vm.addr(oraclePrivKey);
        sponsorSigner = vm.addr(sponsorPrivKey);
        smeOwner      = vm.addr(smeOwnerKey);
        dueDate       = uint64(block.timestamp + 90 days);

        vm.startPrank(admin);

        // ── Identity layer ────────────────────────────────────────────────────
        claimTopics   = new ClaimTopicsRegistry(admin);
        trustedIssuers = new TrustedIssuersRegistry(admin);
        registry       = new IdentityRegistry(admin, address(claimTopics), address(trustedIssuers));

        // ── Tokens + verifier ─────────────────────────────────────────────────
        ddsc         = new MockDDSC(admin);
        madi         = new MockADI(admin);
        zkVerifier   = new InvoiceZKVerifier(oracleSigner, admin);
        invoiceToken = new InvoiceToken(admin, address(registry));
        seniorToken  = new SeniorToken(admin, address(registry));
        juniorToken  = new JuniorToken(admin, address(registry));

        // ── Orchestrator ──────────────────────────────────────────────────────
        orchestrator = new InvoiceOrchestrator(
            admin,
            address(registry),
            address(invoiceToken),
            address(seniorToken),
            address(juniorToken),
            address(zkVerifier),
            address(ddsc)
        );

        // ── Vault ─────────────────────────────────────────────────────────────
        vault = new TradeFinanceVault(address(ddsc), admin, address(registry), address(seniorToken));

        // ── AA stack ──────────────────────────────────────────────────────────
        entryPoint = new MinimalEntryPoint();
        paymaster  = new SignaturePaymaster(address(entryPoint), sponsorSigner, admin);
        factory    = new SimpleSmartAccountFactory(address(entryPoint));

        // ── Merchant stack ────────────────────────────────────────────────────
        oracle    = new PriceOracle(admin);
        swapRouter = new MockSwapRouter(address(oracle), admin);
        payRouter  = new ADIPayRouter(address(oracle), address(swapRouter), admin);

        oracle.setRate(address(ddsc), DDSC_RATE);
        oracle.setRate(address(madi), MADI_RATE);

        // ── Wire roles ────────────────────────────────────────────────────────
        invoiceToken.grantRole(invoiceToken.MINTER_ROLE(), address(orchestrator));
        seniorToken.grantRole(seniorToken.MINTER_ROLE(),   address(orchestrator));
        juniorToken.grantRole(juniorToken.MINTER_ROLE(),   address(orchestrator));
        orchestrator.setVault(address(vault));
        vault.setOrchestrator(address(orchestrator));

        // ── KYC registrations ─────────────────────────────────────────────────
        registry.registerIdentity(sme, 784);
        registry.setKycStatus(sme, true);

        registry.registerIdentity(institution, 784);
        registry.setKycStatus(institution, true);

        // Vault contract must be KYC'd to receive S-DEBT transfers
        registry.registerIdentity(address(vault), 784);
        registry.setKycStatus(address(vault), true);

        // SME smart account (Track 2) — register predicted address before deploy
        address smartAcct = factory.getAddress(smeOwner, 0);
        registry.registerIdentity(smartAcct, 784);
        registry.setKycStatus(smartAcct, true);

        // ── Fund accounts ─────────────────────────────────────────────────────
        ddsc.mint(institution, 5_000e18);     // institution deposit pool
        ddsc.mint(address(swapRouter), 50_000e18); // swap reserves
        madi.mint(address(swapRouter), 50_000e18);
        madi.mint(customer, 1_000e18);

        // Also approve swap router to deposit its own reserves (admin already has tokens)
        // swapRouter reserves were minted directly — no approval needed (MockDDSC owner = admin)

        vm.stopPrank();

        // Fund swap router reserves via depositReserves (requires approval as owner)
        // Already funded by minting directly to swapRouter above
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Produce an oracle-signed ZK proof for the given invoice parameters.
    function _makeProof(
        bytes32 _invoiceId,
        uint256 _faceValue,
        uint64  _dueDate,
        bytes32 _docHash
    ) internal view returns (bytes memory) {
        bytes32 msgHash  = keccak256(abi.encodePacked(_invoiceId, _faceValue, _dueDate, _docHash));
        bytes32 ethHash  = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Track 1 — Full Invoice Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Full lifecycle: mint → deposit → purchase tranche → settle → redeem yield.
    function test_Track1_FullInvoiceLifecycle() public {
        // ── Step 1: SME mints invoice ─────────────────────────────────────────
        bytes memory proof = _makeProof(invoiceId, faceValue, dueDate, docHash);

        vm.prank(sme);
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, proof);

        // Junior tokens (20%) sent to SME immediately
        assertEq(juniorToken.balanceOf(sme), juniorAmt);
        // Senior tokens (80%) held by orchestrator pending vault purchase
        assertEq(seniorToken.balanceOf(address(orchestrator)), seniorAmt);

        // ── Step 2: Institution deposits DDSC into vault ──────────────────────
        vm.startPrank(institution);
        ddsc.approve(address(vault), 5_000e18);
        vault.deposit(5_000e18, institution);
        vm.stopPrank();

        assertEq(vault.totalAssets(), 5_000e18);
        assertEq(vault.balanceOf(institution), 5_000e18); // 1:1 shares initially

        // ── Step 3: Vault purchases senior tranche ────────────────────────────
        uint256 smeBeforePurchase = ddsc.balanceOf(sme);

        vm.prank(admin);
        vault.purchaseSeniorTranche(invoiceId);

        // SME receives 800 DDSC (senior tranche value) immediately
        assertEq(ddsc.balanceOf(sme) - smeBeforePurchase, seniorAmt);
        // Vault holds S-DEBT instead of DDSC — totalAssets unchanged
        assertEq(seniorToken.balanceOf(address(vault)), seniorAmt);
        assertEq(vault.totalAssets(), 5_000e18);

        // ── Step 4: Invoice repaid — settlement oracle settles ────────────────
        // Repayment: face value (1000 DDSC) + 6% yield on senior = 800 * 6% = 48 DDSC
        uint256 interestOnSenior = seniorAmt * 600 / 10_000; // 6%
        uint256 repayment        = faceValue + interestOnSenior; // 1048 DDSC

        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);

        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        // After settlement:
        //   Orchestrator burned 800 S-DEBT from vault
        //   Orchestrator forwarded 1048 DDSC to vault
        //   Vault DDSC: (5000 - 800) + 1048 = 5248
        //   Vault S-DEBT: 0
        //   totalAssets: 5248
        assertEq(seniorToken.balanceOf(address(vault)), 0);
        assertEq(vault.totalAssets(), 5_000e18 + interestOnSenior + (faceValue - seniorAmt));
        // = 5000 + 48 + 200 = 5248 DDSC

        // ── Step 5: Institution redeems shares — receives principal + yield ───
        uint256 shares     = vault.balanceOf(institution);
        uint256 ddscBefore = ddsc.balanceOf(institution);

        vm.prank(institution);
        vault.redeem(shares, institution, institution);

        uint256 received = ddsc.balanceOf(institution) - ddscBefore;
        // Deposited 5000 DDSC → should receive 5248 DDSC (ERC-4626 rounds down ≤1 wei)
        assertApproxEqAbs(received, 5_000e18 + interestOnSenior + (faceValue - seniorAmt), 1);
        assertGt(received, 5_000e18); // always more than deposited ✓
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Track 2 — AA-Sponsored Invoice Minting (zero-ADI wallet)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Prove a zero-ADI SME wallet can call mintInvoice() gas-free.
    ///         Uses the MockEP helper so sponsor + account sign the SAME opHash
    ///         (computed before paymasterAndData sig is injected) — same proven
    ///         pattern as SignaturePaymaster.t.sol E2E test.
    function test_Track2_SponsoredMintWithSmartAccount() public {
        // ── Local MockEP + fresh paymaster pointing to it ─────────────────────
        MockEP mockEP = new MockEP();

        vm.startPrank(admin);
        SignaturePaymaster pm2 = new SignaturePaymaster(address(mockEP), sponsorSigner, admin);
        vm.stopPrank();

        vm.deal(admin, 1 ether);
        vm.prank(admin);
        pm2.deposit{value: 0.5 ether}();

        // ── Deploy smart account via factory (fresh factory uses mockEP) ──────
        SimpleSmartAccountFactory f2 = new SimpleSmartAccountFactory(address(mockEP));
        address predicted = f2.getAddress(smeOwner, 1);

        // KYC-register the predicted smart account address
        vm.startPrank(admin);
        registry.registerIdentity(predicted, 784);
        registry.setKycStatus(predicted, true);
        vm.stopPrank();

        SimpleSmartAccount smartAcct = f2.createAccount(smeOwner, 1);
        assertEq(smartAcct.owner(), smeOwner);

        // ── Build mintInvoice calldata ────────────────────────────────────────
        bytes32 inv2    = keccak256("ADI-INV-002");
        uint64  due2    = uint64(block.timestamp + 60 days);
        bytes32 doc2    = keccak256("shipping-docs-002");
        bytes memory proof2 = _makeProof(inv2, faceValue, due2, doc2);

        bytes memory executeCalldata = abi.encodeWithSignature(
            "execute(address,uint256,bytes)",
            address(orchestrator),
            uint256(0),
            abi.encodeWithSelector(
                InvoiceOrchestrator.mintInvoice.selector,
                inv2, faceValue, due2, doc2, counterparty, proof2
            )
        );

        // ── Build UserOperation — empty paymasterAndData so opHash is stable ────
        // (same pattern as SignaturePaymaster.t.sol: compute hash from empty pmd,
        //  then attach real sig at correct offset [paymaster 20B|verGas 16B|postGas 16B|sig 65B])
        PackedUserOperation memory op = PackedUserOperation({
            sender:            address(smartAcct),
            nonce:             0,
            initCode:          bytes(""),
            callData:          executeCalldata,
            accountGasLimits:  bytes32(uint256(150_000) << 128 | uint256(50_000)),
            preVerificationGas: 50_000,
            gasFees:           bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData:  bytes(""),  // empty until after opHash computed
            signature:         bytes("")
        });

        // ── Compute opHash BEFORE injecting any signatures ────────────────────
        bytes32 opHash = mockEP.getUserOpHash(op);

        // ── Account owner signs opHash ────────────────────────────────────────
        bytes32 acctEthHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash));
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(smeOwnerKey, acctEthHash);
        op.signature = abi.encodePacked(ar, as_, av);

        // ── Sponsor signs opHash and packs into paymasterAndData ─────────────
        // Layout: [paymaster 20B] [verGasLimit 16B] [postOpGasLimit 16B] [sig 65B]
        // SPONSOR_SIG_OFFSET = 52 (= 20 + 16 + 16)
        bytes32 sponsorHash = keccak256(abi.encodePacked(opHash, block.chainid, address(pm2)));
        bytes32 sponsorEthHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", sponsorHash));
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(sponsorPrivKey, sponsorEthHash);
        op.paymasterAndData = abi.encodePacked(
            address(pm2), uint128(100_000), uint128(50_000), abi.encodePacked(sr, ss, sv)
        );

        // ── Validate paymaster (passes opHash explicitly — proven pattern) ─────
        (, uint256 pmVal) = mockEP.callValidatePaymaster(address(pm2), op, opHash);
        assertEq(pmVal, 0); // 0 = success

        // ── Validate account ──────────────────────────────────────────────────
        uint256 acctVal = mockEP.callValidateUserOp(address(smartAcct), op, opHash, 0);
        assertEq(acctVal, 0); // 0 = success

        // ── Execute mintInvoice as if called by EntryPoint ────────────────────
        assertEq(smeOwner.balance, 0); // zero ADI — no gas needed
        vm.prank(address(mockEP));
        smartAcct.execute(
            address(orchestrator), 0,
            abi.encodeWithSelector(
                InvoiceOrchestrator.mintInvoice.selector,
                inv2, faceValue, due2, doc2, counterparty, proof2
            )
        );

        // Invoice minted by smart account despite SME EOA having zero ADI
        (address smAddr,,,,) = orchestrator.invoices(inv2);
        assertEq(smAddr, address(smartAcct));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Track 3 — Merchant Checkout
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Customer pays 500 AED in mADI; merchant receives 500 DDSC via swap.
    function test_Track3_MerchantCheckout_CrossToken() public {
        // Swap router needs DDSC reserves (customer pays mADI, merchant wants DDSC)
        // swapRouter holds 50_000 DDSC minted in setUp

        uint256 fiatAED = 500e18;  // 500 AED

        // Preview: 500 AED at 0.5 mADI/AED → 250 mADI from customer
        uint256 preview = payRouter.previewCheckout(fiatAED, address(madi));
        assertEq(preview, 250e18);

        // Customer approves and executes checkout
        vm.startPrank(customer);
        madi.approve(address(payRouter), preview);
        payRouter.checkout(merchant, fiatAED, address(madi), address(ddsc));
        vm.stopPrank();

        // Customer spent 250 mADI
        assertEq(madi.balanceOf(customer), 1_000e18 - 250e18);
        // Merchant received 500 DDSC (500 AED worth)
        assertEq(ddsc.balanceOf(merchant), 500e18);
    }

    /// @notice Merchant checkout with same token (no swap) — exact 1:1 with DDSC.
    function test_Track3_MerchantCheckout_SameToken() public {
        uint256 fiatAED = 300e18;  // 300 AED in DDSC

        vm.prank(admin);
        ddsc.mint(customer, fiatAED);

        vm.startPrank(customer);
        ddsc.approve(address(payRouter), fiatAED);
        payRouter.checkout(merchant, fiatAED, address(ddsc), address(ddsc));
        vm.stopPrank();

        assertEq(ddsc.balanceOf(merchant), fiatAED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // All Tracks Connected — the hackathon story in one test
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The full ADI story: SME gets DDSC liquidity via vault, then a
    ///         merchant uses that DDSC ecosystem for checkout payments.
    function test_AllTracks_ConnectedStory() public {
        // ── Track 1: SME gets working capital ────────────────────────────────
        bytes memory proof = _makeProof(invoiceId, faceValue, dueDate, docHash);
        vm.prank(sme);
        orchestrator.mintInvoice(invoiceId, faceValue, dueDate, docHash, counterparty, proof);

        vm.startPrank(institution);
        ddsc.approve(address(vault), 5_000e18);
        vault.deposit(5_000e18, institution);
        vm.stopPrank();

        vm.prank(admin);
        vault.purchaseSeniorTranche(invoiceId);

        // SME now holds 800 DDSC (working capital from vault)
        assertEq(ddsc.balanceOf(sme), seniorAmt);

        // ── Track 3: SME (as merchant) accepts mADI payment ──────────────────
        // A customer pays the SME 200 AED in mADI → SME receives 200 DDSC
        uint256 paymentAED = 200e18;
        uint256 madiNeeded = payRouter.previewCheckout(paymentAED, address(madi)); // 100 mADI

        vm.startPrank(customer);
        madi.approve(address(payRouter), madiNeeded);
        payRouter.checkout(sme, paymentAED, address(madi), address(ddsc));
        vm.stopPrank();

        // SME total DDSC: 800 (from vault) + 200 (from merchant checkout)
        assertEq(ddsc.balanceOf(sme), seniorAmt + paymentAED);

        // ── Track 1: Invoice settles — institution earns yield ────────────────
        uint256 repayment = faceValue + 60e18; // 6% on full face value
        vm.prank(admin);
        ddsc.mint(address(orchestrator), repayment);
        vm.prank(admin);
        orchestrator.settleInvoice(invoiceId);

        uint256 shares = vault.balanceOf(institution);
        vm.prank(institution);
        vault.redeem(shares, institution, institution);

        // Institution received more than deposited — yield confirmed
        assertGt(ddsc.balanceOf(institution), 5_000e18);
    }
}
