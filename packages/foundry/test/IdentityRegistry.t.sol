// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/identity/IdentityRegistry.sol";
import "../src/identity/ClaimTopicsRegistry.sol";
import "../src/identity/TrustedIssuersRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry public registry;
    ClaimTopicsRegistry public claimTopics;
    TrustedIssuersRegistry public trustedIssuers;

    address admin = makeAddr("admin");
    address complianceAgent = makeAddr("complianceAgent");
    address sme = makeAddr("sme");
    address institution = makeAddr("institution");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.startPrank(admin);
        claimTopics = new ClaimTopicsRegistry(admin);
        trustedIssuers = new TrustedIssuersRegistry(admin);
        registry = new IdentityRegistry(admin, address(claimTopics), address(trustedIssuers));
        registry.grantRole(registry.COMPLIANCE_AGENT_ROLE(), complianceAgent);
        vm.stopPrank();
    }

    // ── IdentityRegistry ──────────────────────────────────────────────────────

    function test_RegisterAndVerify() public {
        // Not verified before registration
        assertFalse(registry.isVerified(sme));

        vm.prank(complianceAgent);
        registry.registerIdentity(sme, 784); // UAE country code

        // Still not verified — KYC not approved yet
        assertFalse(registry.isVerified(sme));

        vm.prank(complianceAgent);
        registry.setKycStatus(sme, true);

        assertTrue(registry.isVerified(sme));
    }

    function test_RevokeIdentity() public {
        vm.startPrank(complianceAgent);
        registry.registerIdentity(sme, 784);
        registry.setKycStatus(sme, true);
        vm.stopPrank();

        assertTrue(registry.isVerified(sme));

        vm.prank(complianceAgent);
        registry.revokeIdentity(sme);

        assertFalse(registry.isVerified(sme));
    }

    function test_CannotRegisterTwice() public {
        vm.startPrank(complianceAgent);
        registry.registerIdentity(sme, 784);
        vm.expectRevert("Already registered");
        registry.registerIdentity(sme, 784);
        vm.stopPrank();
    }

    function test_OnlyComplianceAgentCanRegister() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.registerIdentity(sme, 784);
    }

    function test_RevokeNonExistentReverts() public {
        vm.prank(complianceAgent);
        vm.expectRevert("Not registered");
        registry.revokeIdentity(sme);
    }

    function test_GetIdentityReturnsRecord() public {
        vm.startPrank(complianceAgent);
        registry.registerIdentity(institution, 784);
        registry.setKycStatus(institution, true);
        vm.stopPrank();

        IdentityRegistry.IdentityRecord memory rec = registry.getIdentity(institution);
        assertTrue(rec.registered);
        assertTrue(rec.kycApproved);
        assertEq(rec.country, 784);
    }

    // ── ClaimTopicsRegistry ───────────────────────────────────────────────────

    function test_AddAndGetClaimTopics() public {
        vm.startPrank(admin);
        claimTopics.addClaimTopic(1); // KYC
        claimTopics.addClaimTopic(2); // Accredited
        claimTopics.addClaimTopic(3); // AML
        vm.stopPrank();

        uint256[] memory topics = claimTopics.getClaimTopics();
        assertEq(topics.length, 3);
        assertEq(topics[0], 1);
        assertEq(topics[1], 2);
        assertEq(topics[2], 3);
    }

    function test_RemoveClaimTopic() public {
        vm.startPrank(admin);
        claimTopics.addClaimTopic(1);
        claimTopics.addClaimTopic(2);
        claimTopics.removeClaimTopic(1);
        vm.stopPrank();

        uint256[] memory topics = claimTopics.getClaimTopics();
        assertEq(topics.length, 1);
        assertEq(topics[0], 2);
    }

    function test_DuplicateClaimTopicReverts() public {
        vm.startPrank(admin);
        claimTopics.addClaimTopic(1);
        vm.expectRevert("Topic already exists");
        claimTopics.addClaimTopic(1);
        vm.stopPrank();
    }

    function test_OnlyAdminCanAddClaimTopic() public {
        vm.prank(stranger);
        vm.expectRevert();
        claimTopics.addClaimTopic(1);
    }

    // ── TrustedIssuersRegistry ────────────────────────────────────────────────

    function test_AddAndCheckTrustedIssuer() public {
        address issuer = makeAddr("issuer");

        assertFalse(trustedIssuers.isTrustedIssuer(issuer));

        vm.prank(admin);
        trustedIssuers.addTrustedIssuer(issuer);

        assertTrue(trustedIssuers.isTrustedIssuer(issuer));
    }

    function test_RemoveTrustedIssuer() public {
        address issuer = makeAddr("issuer");

        vm.startPrank(admin);
        trustedIssuers.addTrustedIssuer(issuer);
        trustedIssuers.removeTrustedIssuer(issuer);
        vm.stopPrank();

        assertFalse(trustedIssuers.isTrustedIssuer(issuer));
        assertEq(trustedIssuers.getTrustedIssuers().length, 0);
    }

    function test_DuplicateIssuerReverts() public {
        address issuer = makeAddr("issuer");

        vm.startPrank(admin);
        trustedIssuers.addTrustedIssuer(issuer);
        vm.expectRevert("Already trusted");
        trustedIssuers.addTrustedIssuer(issuer);
        vm.stopPrank();
    }

    function test_OnlyAdminCanAddIssuer() public {
        vm.prank(stranger);
        vm.expectRevert();
        trustedIssuers.addTrustedIssuer(makeAddr("issuer"));
    }
}
