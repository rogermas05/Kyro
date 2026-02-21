// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/mocks/MockDDSC.sol";
import "../src/mocks/MockADI.sol";
import "../src/identity/ClaimTopicsRegistry.sol";
import "../src/identity/TrustedIssuersRegistry.sol";
import "../src/identity/IdentityRegistry.sol";

/// @notice Deploys the identity layer + mock tokens.
///
/// Usage (anvil):
///   forge script script/01_DeployIdentity.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast --root packages/foundry
///
/// Usage (ADI testnet):
///   forge script script/01_DeployIdentity.s.sol \
///     --rpc-url $ADI_RPC_URL --broadcast --root packages/foundry
///
/// Outputs: Set these env vars before running the next script:
///   DDSC_ADDRESS, MADI_ADDRESS, CLAIM_TOPICS_ADDRESS,
///   TRUSTED_ISSUERS_ADDRESS, IDENTITY_REGISTRY_ADDRESS
contract DeployIdentity is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Mock tokens
        MockDDSC ddsc = new MockDDSC(deployer);
        MockADI  madi = new MockADI(deployer);

        // Identity layer
        ClaimTopicsRegistry    claimTopics    = new ClaimTopicsRegistry(deployer);
        TrustedIssuersRegistry trustedIssuers = new TrustedIssuersRegistry(deployer);
        IdentityRegistry       registry       = new IdentityRegistry(
            deployer, address(claimTopics), address(trustedIssuers)
        );

        vm.stopBroadcast();

        console.log("=== Phase 01: Identity Layer ===");
        console.log("MockDDSC:              ", address(ddsc));
        console.log("MockADI:               ", address(madi));
        console.log("ClaimTopicsRegistry:   ", address(claimTopics));
        console.log("TrustedIssuersRegistry:", address(trustedIssuers));
        console.log("IdentityRegistry:      ", address(registry));
        console.log("");
        console.log("Export for next script:");
        console.log("export DDSC_ADDRESS=%s",               address(ddsc));
        console.log("export MADI_ADDRESS=%s",               address(madi));
        console.log("export CLAIM_TOPICS_ADDRESS=%s",       address(claimTopics));
        console.log("export TRUSTED_ISSUERS_ADDRESS=%s",    address(trustedIssuers));
        console.log("export IDENTITY_REGISTRY_ADDRESS=%s",  address(registry));
    }
}
