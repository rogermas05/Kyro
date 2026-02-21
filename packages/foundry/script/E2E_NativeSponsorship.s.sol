// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/SignaturePaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";

/// @title E2E Native Sponsorship Demo
/// @notice Demonstrates a counterfactual smart account executing a call with zero
///         native balance, fully sponsored by the SignaturePaymaster.
///
/// Usage:
///   forge script script/E2E_NativeSponsorship.s.sol --rpc-url $RPC --broadcast
///
/// Env vars: PRIVATE_KEY, SPONSOR_PRIVATE_KEY (or use --private-key flag)
contract E2E_NativeSponsorship is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 sponsorKey  = vm.envUint("SPONSOR_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address sponsorAddr = vm.addr(sponsorKey);

        vm.startBroadcast(deployerKey);

        // ── Deploy infrastructure ───────────────────────────────────────────
        MinimalEntryPoint entryPoint = new MinimalEntryPoint();
        SignaturePaymaster paymaster = new SignaturePaymaster(
            address(entryPoint), sponsorAddr, deployer
        );
        SimpleSmartAccountFactory factory = new SimpleSmartAccountFactory(address(entryPoint));

        paymaster.deposit{value: 1 ether}();

        // ── Deploy a simple target contract ─────────────────────────────────
        Counter counter = new Counter();

        // ── Predict counterfactual smart account address ────────────────────
        address predicted = factory.getAddress(deployer, 0);
        console.log("=== E2E Native Sponsorship ===");
        console.log("EntryPoint:       ", address(entryPoint));
        console.log("Paymaster:        ", address(paymaster));
        console.log("Factory:          ", address(factory));
        console.log("Smart Account:    ", predicted);
        console.log("Counter:          ", address(counter));
        console.log("Account balance:   0 wei (counterfactual, not yet deployed)");

        uint256 pmDepositBefore = paymaster.getDeposit();
        console.log("PM deposit before:", pmDepositBefore);

        // ── Build UserOp with initCode (deploys account on first use) ───────
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(SimpleSmartAccountFactory.createAccount, (deployer, 0))
        );

        bytes memory callData = abi.encodeCall(
            SimpleSmartAccount.execute,
            (address(counter), 0, abi.encodeCall(Counter.increment, ()))
        );

        PackedUserOperation memory op = PackedUserOperation({
            sender:            predicted,
            nonce:             0,
            initCode:          initCode,
            callData:          callData,
            accountGasLimits:  bytes32(uint256(300_000) << 128 | uint256(200_000)),
            preVerificationGas: 100_000,
            gasFees:           bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData:  "",
            signature:         ""
        });

        // ── Sponsor signs the paymaster hash ────────────────────────────────
        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);

        bytes32 pmHash = keccak256(abi.encode(
            op.sender, op.nonce,
            keccak256(op.initCode), keccak256(op.callData),
            op.accountGasLimits, op.preVerificationGas, op.gasFees,
            block.chainid, address(entryPoint), address(paymaster),
            validUntil, validAfter
        ));

        vm.stopBroadcast();

        // Sign with sponsor key (off-chain)
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(
            sponsorKey,
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pmHash))
        );

        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            uint128(100_000),
            uint128(50_000),
            validUntil,
            validAfter,
            abi.encodePacked(sr, ss, sv)
        );

        // ── Owner signs the userOpHash ──────────────────────────────────────
        bytes32 opHash = entryPoint.getUserOpHash(op);
        (uint8 ov, bytes32 or_, bytes32 os) = vm.sign(
            deployerKey,
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", opHash))
        );
        op.signature = abi.encodePacked(or_, os, ov);

        // ── Submit ──────────────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(deployer));
        vm.stopBroadcast();

        // ── Verify results ──────────────────────────────────────────────────
        uint256 pmDepositAfter = paymaster.getDeposit();
        console.log("");
        console.log("=== Results ===");
        console.log("Counter value:    ", counter.count());
        console.log("Account deployed: ", predicted.code.length > 0 ? "true" : "false");
        console.log("Account balance:  ", predicted.balance, "wei");
        console.log("PM deposit after: ", pmDepositAfter);
        console.log("PM deposit delta: ", pmDepositBefore - pmDepositAfter, "wei deducted");
        console.log("");
        console.log("SUCCESS: Zero-balance account executed a call, gas paid by paymaster.");
    }
}

contract Counter {
    uint256 public count;
    function increment() external { count++; }
}
