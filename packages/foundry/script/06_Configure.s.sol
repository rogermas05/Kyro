// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/identity/IdentityRegistry.sol";
import "../src/asset/InvoiceOrchestrator.sol";
import "../src/asset/SeniorToken.sol";
import "../src/vault/TradeFinanceVault.sol";
import "../src/mocks/MockDDSC.sol";
import "../src/mocks/MockADI.sol";
import "../src/merchant/MockSwapRouter.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

/// @notice Wires all deployed contracts together and registers initial identities.
///
/// Requires ALL env vars from scripts 01–05, plus optional actor addresses:
///   SME_ADDRESS           — KYC-register as SME (optional)
///   INSTITUTION_ADDRESS   — KYC-register as institutional investor (optional)
///   SWAP_RESERVE_DDSC     — DDSC to seed into swap router (default: 10_000e18)
///   SWAP_RESERVE_MADI     — mADI to seed into swap router (default: 10_000e18)
contract Configure is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        // ── Load all addresses ────────────────────────────────────────────────
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        address ddscAddr         = vm.envAddress("DDSC_ADDRESS");
        address madiAddr         = vm.envAddress("MADI_ADDRESS");
        address seniorTokenAddr  = vm.envAddress("SENIOR_TOKEN_ADDRESS");
        address orchestratorAddr = vm.envAddress("ORCHESTRATOR_ADDRESS");
        address vaultAddr        = vm.envAddress("VAULT_ADDRESS");
        address swapRouterAddr   = vm.envAddress("SWAP_ROUTER_ADDRESS");
        address factoryAddr      = vm.envAddress("SMART_ACCOUNT_FACTORY_ADDRESS");

        address smeAddr         = vm.envOr("SME_ADDRESS",         address(0));
        address institutionAddr = vm.envOr("INSTITUTION_ADDRESS", address(0));

        uint256 reserveDdsc = vm.envOr("SWAP_RESERVE_DDSC", uint256(10_000e18));
        uint256 reserveMadi = vm.envOr("SWAP_RESERVE_MADI", uint256(10_000e18));

        IdentityRegistry    registry     = IdentityRegistry(identityRegistry);
        InvoiceOrchestrator orchestrator = InvoiceOrchestrator(orchestratorAddr);
        TradeFinanceVault   vault        = TradeFinanceVault(vaultAddr);
        MockDDSC            ddsc         = MockDDSC(ddscAddr);
        MockADI             madi         = MockADI(madiAddr);
        MockSwapRouter      swapRouter   = MockSwapRouter(swapRouterAddr);

        vm.startBroadcast(deployerKey);

        // ── 1. Wire Orchestrator ↔ Vault ──────────────────────────────────────
        orchestrator.setVault(vaultAddr);
        vault.setOrchestrator(orchestratorAddr);

        // ── 2. KYC-register the vault (receives S-DEBT) ───────────────────────
        registry.registerIdentity(vaultAddr, 784); // UAE country code
        registry.setKycStatus(vaultAddr, true);

        // ── 3. Register optional actors ───────────────────────────────────────
        if (smeAddr != address(0)) {
            registry.registerIdentity(smeAddr, 784);
            registry.setKycStatus(smeAddr, true);
            console.log("KYC registered SME:", smeAddr);
        }
        if (institutionAddr != address(0)) {
            registry.registerIdentity(institutionAddr, 784);
            registry.setKycStatus(institutionAddr, true);
            console.log("KYC registered institution:", institutionAddr);
        }

        // ── 4. Seed swap router reserves ─────────────────────────────────────
        if (reserveDdsc > 0) {
            ddsc.mint(deployer, reserveDdsc);
            ddsc.approve(swapRouterAddr, reserveDdsc);
            swapRouter.depositReserves(ddscAddr, reserveDdsc);
        }
        if (reserveMadi > 0) {
            madi.mint(deployer, reserveMadi);
            madi.approve(swapRouterAddr, reserveMadi);
            swapRouter.depositReserves(madiAddr, reserveMadi);
        }

        // ── 5. Mint demo tokens to SME and institution ────────────────────────
        if (smeAddr != address(0)) {
            ddsc.mint(smeAddr, 1_000e18); // 1000 DDSC to cover junior tranche scenario
            console.log("Minted 1000 DDSC to SME");
        }
        if (institutionAddr != address(0)) {
            ddsc.mint(institutionAddr, 100_000e18); // 100k DDSC for vault deposits
            console.log("Minted 100,000 DDSC to institution");
        }

        vm.stopBroadcast();

        console.log("=== Phase 06: Configuration Complete ===");
        console.log("Vault wired to Orchestrator: OK");
        console.log("Vault KYC registered:        OK");
        console.log("Swap reserves funded:");
        console.log("  DDSC:", reserveDdsc);
        console.log("  mADI:", reserveMadi);
        console.log("");
        console.log("=== All contracts ready. Update packages/nextjs/.env.local: ===");
        console.log("NEXT_PUBLIC_ORCHESTRATOR_ADDRESS=%s", orchestratorAddr);
        console.log("NEXT_PUBLIC_VAULT_ADDRESS=%s",        vaultAddr);
        console.log("NEXT_PUBLIC_DDSC_ADDRESS=%s",         ddscAddr);
        console.log("NEXT_PUBLIC_MADI_ADDRESS=%s",         madiAddr);
        console.log("NEXT_PUBLIC_ORACLE_ADDRESS=%s",       vm.envAddress("PRICE_ORACLE_ADDRESS"));
        console.log("NEXT_PUBLIC_ROUTER_ADDRESS=%s",       vm.envAddress("PAY_ROUTER_ADDRESS"));
    }
}
