// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/merchant/PriceOracle.sol";
import "../src/merchant/MockSwapRouter.sol";
import "../src/merchant/ADIPayRouter.sol";

/// @notice Deploys the Track 3 merchant checkout stack:
///         PriceOracle, MockSwapRouter, ADIPayRouter.
///         Also seeds oracle rates for DDSC and mADI.
///
/// Requires env vars:
///   DDSC_ADDRESS, MADI_ADDRESS
///
/// Optional:
///   DDSC_RATE   — token-wei per 1 AED (default: 1e18  → 1 DDSC = 1 AED)
///   MADI_RATE   — token-wei per 1 AED (default: 5e17  → 1 mADI = 2 AED)
///
/// Outputs: PRICE_ORACLE_ADDRESS, SWAP_ROUTER_ADDRESS, PAY_ROUTER_ADDRESS
contract DeployMerchant is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address ddsc        = vm.envAddress("DDSC_ADDRESS");
        address madi        = vm.envAddress("MADI_ADDRESS");
        uint256 ddscRate    = vm.envOr("DDSC_RATE", uint256(1e18));
        uint256 madiRate    = vm.envOr("MADI_RATE", uint256(5e17));

        vm.startBroadcast(deployerKey);

        PriceOracle    oracle     = new PriceOracle(deployer);
        MockSwapRouter swapRouter = new MockSwapRouter(address(oracle), deployer);
        ADIPayRouter   payRouter  = new ADIPayRouter(address(oracle), address(swapRouter), deployer);

        // Seed oracle rates
        oracle.setRate(ddsc, ddscRate);
        oracle.setRate(madi, madiRate);

        vm.stopBroadcast();

        console.log("=== Phase 05: Merchant Checkout ===");
        console.log("PriceOracle:   ", address(oracle));
        console.log("MockSwapRouter:", address(swapRouter));
        console.log("ADIPayRouter:  ", address(payRouter));
        console.log("DDSC rate:     ", ddscRate, "(token-wei per AED)");
        console.log("mADI rate:     ", madiRate, "(token-wei per AED)");
        console.log("");
        console.log("export PRICE_ORACLE_ADDRESS=%s",  address(oracle));
        console.log("export SWAP_ROUTER_ADDRESS=%s",   address(swapRouter));
        console.log("export PAY_ROUTER_ADDRESS=%s",    address(payRouter));
        console.log("");
        console.log("Next: fund swap router reserves with DDSC and mADI via");
        console.log("      MockSwapRouter.depositReserves() before accepting swaps.");
    }
}
