// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

/// @notice Deploys the ERC-4337 AA stack: MinimalEntryPoint, SignaturePaymaster, Factory.
///
/// Requires env vars:
///   SPONSOR_SIGNER_ADDRESS  — address whose private key the `adig sponsor:sign` server uses
///
/// Optional:
///   PAYMASTER_DEPOSIT_ETH   — initial deposit in wei for the paymaster (default: 0.1 ether)
///
/// Outputs: ENTRY_POINT_ADDRESS, PAYMASTER_ADDRESS, SMART_ACCOUNT_FACTORY_ADDRESS
contract DeployAA is Script {
    function run() external {
        uint256 deployerKey     = vm.envUint("PRIVATE_KEY");
        address deployer        = vm.addr(deployerKey);
        address sponsorSigner   = vm.envAddress("SPONSOR_SIGNER_ADDRESS");
        uint256 depositAmt      = vm.envOr("PAYMASTER_DEPOSIT_ETH", uint256(0.1 ether));

        vm.startBroadcast(deployerKey);

        // Deploy EntryPoint (MinimalEntryPoint for testnet)
        MinimalEntryPoint entryPoint = new MinimalEntryPoint();

        // Deploy Paymaster + deposit initial funds
        SignaturePaymaster paymaster = new SignaturePaymaster(
            address(entryPoint), sponsorSigner, deployer
        );
        paymaster.deposit{value: depositAmt}();

        // Deploy factory for deterministic smart account addresses
        SimpleSmartAccountFactory factory = new SimpleSmartAccountFactory(address(entryPoint));

        vm.stopBroadcast();

        console.log("=== Phase 04: AA Stack ===");
        console.log("MinimalEntryPoint:          ", address(entryPoint));
        console.log("SignaturePaymaster:          ", address(paymaster));
        console.log("SimpleSmartAccountFactory:  ", address(factory));
        console.log("Paymaster deposit:          ", depositAmt, "wei");
        console.log("");
        console.log("export ENTRY_POINT_ADDRESS=%s",            address(entryPoint));
        console.log("export PAYMASTER_ADDRESS=%s",              address(paymaster));
        console.log("export SMART_ACCOUNT_FACTORY_ADDRESS=%s",  address(factory));
        console.log("");
        console.log("adig CLI config:");
        console.log("  adig sponsor:sign --paymaster %s --port 3001", address(paymaster));
    }
}
