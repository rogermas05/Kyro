// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/asset/InvoiceZKVerifier.sol";
import "../src/asset/InvoiceToken.sol";
import "../src/asset/SeniorToken.sol";
import "../src/asset/JuniorToken.sol";
import "../src/asset/InvoiceOrchestrator.sol";

/// @notice Deploys the asset orchestration layer.
///
/// Requires env vars from 01_DeployIdentity.s.sol:
///   IDENTITY_REGISTRY_ADDRESS, DDSC_ADDRESS
/// Plus:
///   ZK_ORACLE_ADDRESS  — the trusted oracle that signs ZK proofs
///
/// Outputs: INVOICE_ZK_VERIFIER_ADDRESS, INVOICE_TOKEN_ADDRESS,
///          SENIOR_TOKEN_ADDRESS, JUNIOR_TOKEN_ADDRESS, ORCHESTRATOR_ADDRESS
contract DeployAssetLayer is Script {
    function run() external {
        uint256 deployerKey     = vm.envUint("PRIVATE_KEY");
        address deployer        = vm.addr(deployerKey);
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        address ddsc            = vm.envAddress("DDSC_ADDRESS");
        address zkOracle        = vm.envAddress("ZK_ORACLE_ADDRESS");

        vm.startBroadcast(deployerKey);

        InvoiceZKVerifier verifier    = new InvoiceZKVerifier(zkOracle, deployer);
        InvoiceToken      invoiceTok  = new InvoiceToken(deployer, identityRegistry);
        SeniorToken       seniorTok   = new SeniorToken(deployer, identityRegistry);
        JuniorToken       juniorTok   = new JuniorToken(deployer, identityRegistry);

        InvoiceOrchestrator orchestrator = new InvoiceOrchestrator(
            deployer,
            identityRegistry,
            address(invoiceTok),
            address(seniorTok),
            address(juniorTok),
            address(verifier),
            ddsc
        );

        // Grant orchestrator MINTER_ROLE on all tranche tokens
        invoiceTok.grantRole(invoiceTok.MINTER_ROLE(), address(orchestrator));
        seniorTok.grantRole(seniorTok.MINTER_ROLE(),   address(orchestrator));
        juniorTok.grantRole(juniorTok.MINTER_ROLE(),   address(orchestrator));

        vm.stopBroadcast();

        console.log("=== Phase 02: Asset Layer ===");
        console.log("InvoiceZKVerifier: ", address(verifier));
        console.log("InvoiceToken:      ", address(invoiceTok));
        console.log("SeniorToken:       ", address(seniorTok));
        console.log("JuniorToken:       ", address(juniorTok));
        console.log("InvoiceOrchestrator:", address(orchestrator));
        console.log("");
        console.log("export INVOICE_ZK_VERIFIER_ADDRESS=%s", address(verifier));
        console.log("export INVOICE_TOKEN_ADDRESS=%s",       address(invoiceTok));
        console.log("export SENIOR_TOKEN_ADDRESS=%s",        address(seniorTok));
        console.log("export JUNIOR_TOKEN_ADDRESS=%s",        address(juniorTok));
        console.log("export ORCHESTRATOR_ADDRESS=%s",        address(orchestrator));
    }
}
