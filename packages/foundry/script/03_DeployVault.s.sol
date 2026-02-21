// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/vault/TradeFinanceVault.sol";

/// @notice Deploys the ERC-4626 Trade Finance Vault.
///
/// Requires env vars:
///   DDSC_ADDRESS, IDENTITY_REGISTRY_ADDRESS, SENIOR_TOKEN_ADDRESS
///
/// Outputs: VAULT_ADDRESS
contract DeployVault is Script {
    function run() external {
        uint256 deployerKey      = vm.envUint("PRIVATE_KEY");
        address deployer         = vm.addr(deployerKey);
        address ddsc             = vm.envAddress("DDSC_ADDRESS");
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        address seniorToken      = vm.envAddress("SENIOR_TOKEN_ADDRESS");

        vm.startBroadcast(deployerKey);

        TradeFinanceVault vault = new TradeFinanceVault(
            ddsc, deployer, identityRegistry, seniorToken
        );

        vm.stopBroadcast();

        console.log("=== Phase 03: Vault ===");
        console.log("TradeFinanceVault:", address(vault));
        console.log("");
        console.log("export VAULT_ADDRESS=%s", address(vault));
    }
}
