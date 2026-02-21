// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/ERC20TokenPaymaster.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

/// @notice Deploys the ERC-4337 AA stack:
///         MinimalEntryPoint, SignaturePaymaster, ERC20TokenPaymaster, Factory.
///
/// Requires env vars:
///   SPONSOR_SIGNER_ADDRESS  — address whose private key the sponsor:sign server uses
///   DDSC_ADDRESS            — MockDDSC ERC20 token address (for ERC20 paymaster)
///
/// Optional:
///   PAYMASTER_DEPOSIT_ETH   — initial deposit in wei for each paymaster (default: 0.1 ether)
///   ERC20_EXCHANGE_RATE     — token-wei per native-wei, scaled 1e18 (default: 3600e18)
///
/// Outputs: addresses for all AA contracts
contract DeployAA is Script {
    function run() external {
        uint256 deployerKey     = vm.envUint("PRIVATE_KEY");
        address deployer        = vm.addr(deployerKey);
        address sponsorSigner   = vm.envAddress("SPONSOR_SIGNER_ADDRESS");
        address ddscAddr        = vm.envAddress("DDSC_ADDRESS");
        uint256 depositAmt      = vm.envOr("PAYMASTER_DEPOSIT_ETH", uint256(0.1 ether));
        uint256 exchangeRate    = vm.envOr("ERC20_EXCHANGE_RATE", uint256(3600e18));

        vm.startBroadcast(deployerKey);

        MinimalEntryPoint entryPoint = new MinimalEntryPoint();

        SignaturePaymaster nativePaymaster = new SignaturePaymaster(
            address(entryPoint), sponsorSigner, deployer
        );
        nativePaymaster.deposit{value: depositAmt}();

        ERC20TokenPaymaster erc20Paymaster = new ERC20TokenPaymaster(
            address(entryPoint), sponsorSigner, ddscAddr, exchangeRate, deployer
        );
        erc20Paymaster.deposit{value: depositAmt}();

        SimpleSmartAccountFactory factory = new SimpleSmartAccountFactory(address(entryPoint));

        vm.stopBroadcast();

        console.log("=== Phase 04: AA Stack ===");
        console.log("MinimalEntryPoint:          ", address(entryPoint));
        console.log("SignaturePaymaster (native): ", address(nativePaymaster));
        console.log("ERC20TokenPaymaster:         ", address(erc20Paymaster));
        console.log("SimpleSmartAccountFactory:   ", address(factory));
        console.log("DDSC Token:                  ", ddscAddr);
        console.log("Exchange Rate:               ", exchangeRate);
        console.log("Paymaster deposits:          ", depositAmt, "wei each");
        console.log("");
        console.log("export ENTRY_POINT_ADDRESS=%s",                address(entryPoint));
        console.log("export PAYMASTER_ADDRESS=%s",                  address(nativePaymaster));
        console.log("export ERC20_PAYMASTER_ADDRESS=%s",            address(erc20Paymaster));
        console.log("export SMART_ACCOUNT_FACTORY_ADDRESS=%s",      address(factory));
        console.log("");
        console.log("Frontend env vars (add to .env.local):");
        console.log("  NEXT_PUBLIC_ENTRY_POINT_ADDRESS=%s",            address(entryPoint));
        console.log("  NEXT_PUBLIC_PAYMASTER_ADDRESS=%s",              address(nativePaymaster));
        console.log("  NEXT_PUBLIC_ERC20_PAYMASTER_ADDRESS=%s",        address(erc20Paymaster));
        console.log("  NEXT_PUBLIC_SMART_ACCOUNT_FACTORY_ADDRESS=%s",  address(factory));
    }
}
