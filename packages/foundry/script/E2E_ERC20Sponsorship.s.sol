// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/aa/interfaces/ERC4337.sol";
import "../src/aa/MinimalEntryPoint.sol";
import "../src/aa/ERC20TokenPaymaster.sol";
import "../src/aa/SimpleSmartAccount.sol";
import "../src/aa/SimpleSmartAccountFactory.sol";
import "../src/mocks/MockDDSC.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title E2E ERC20 Sponsorship Demo
/// @notice Demonstrates a smart account with zero native balance paying for gas
///         in DDSC (ERC20) via the ERC20TokenPaymaster.
///
/// Usage:
///   forge script script/E2E_ERC20Sponsorship.s.sol --rpc-url $RPC --broadcast
contract E2E_ERC20Sponsorship is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 sponsorKey  = vm.envUint("SPONSOR_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address sponsorAddr = vm.addr(sponsorKey);

        vm.startBroadcast(deployerKey);

        // ── Deploy infrastructure ───────────────────────────────────────────
        MinimalEntryPoint entryPoint = new MinimalEntryPoint();
        MockDDSC ddsc = new MockDDSC(deployer);

        uint256 exchangeRate = 3600e18; // 3600 DDSC per 1 ADI
        ERC20TokenPaymaster paymaster = new ERC20TokenPaymaster(
            address(entryPoint), sponsorAddr, address(ddsc), exchangeRate, deployer
        );
        SimpleSmartAccountFactory factory = new SimpleSmartAccountFactory(address(entryPoint));

        paymaster.deposit{value: 1 ether}();

        Counter counter = new Counter();

        // ── Create smart account ────────────────────────────────────────────
        SimpleSmartAccount account = factory.createAccount(deployer, 0);
        address acctAddr = address(account);

        // Fund account with ERC20 only (zero native)
        ddsc.mint(acctAddr, 500e18);

        // Account approves paymaster to pull DDSC (via EntryPoint)
        // For the demo, deployer calls execute directly since it's also the owner
        account.execute(
            address(ddsc), 0,
            abi.encodeCall(IERC20.approve, (address(paymaster), type(uint256).max))
        );

        console.log("=== E2E ERC20 Sponsorship ===");
        console.log("EntryPoint:        ", address(entryPoint));
        console.log("DDSC Token:        ", address(ddsc));
        console.log("ERC20 Paymaster:   ", address(paymaster));
        console.log("Smart Account:     ", acctAddr);
        console.log("Counter:           ", address(counter));
        console.log("Exchange Rate:      3600 DDSC per 1 ADI");

        uint256 pmDepositBefore = paymaster.getDeposit();
        uint256 ddscBefore      = ddsc.balanceOf(acctAddr);
        uint256 pmDdscBefore    = ddsc.balanceOf(address(paymaster));
        console.log("");
        console.log("--- Before ---");
        console.log("Account ADI:       ", acctAddr.balance, "wei");
        console.log("Account DDSC:      ", ddscBefore);
        console.log("PM native deposit: ", pmDepositBefore);
        console.log("PM DDSC collected: ", pmDdscBefore);

        // ── Build UserOp ────────────────────────────────────────────────────
        uint256 maxTokenCost = 100e18;

        bytes memory callData = abi.encodeCall(
            SimpleSmartAccount.execute,
            (address(counter), 0, abi.encodeCall(Counter.increment, ()))
        );

        PackedUserOperation memory op = PackedUserOperation({
            sender:            acctAddr,
            nonce:             entryPoint.getNonce(acctAddr, 0),
            initCode:          "",
            callData:          callData,
            accountGasLimits:  bytes32(uint256(200_000) << 128 | uint256(100_000)),
            preVerificationGas: 50_000,
            gasFees:           bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData:  "",
            signature:         ""
        });

        // ── Sponsor signs ───────────────────────────────────────────────────
        uint48 validUntil = uint48(block.timestamp + 600);
        uint48 validAfter = uint48(block.timestamp);

        bytes32 pmHash = keccak256(abi.encode(
            op.sender, op.nonce,
            keccak256(op.initCode), keccak256(op.callData),
            op.accountGasLimits, op.preVerificationGas, op.gasFees,
            block.chainid, address(entryPoint), address(paymaster),
            validUntil, validAfter, maxTokenCost
        ));

        vm.stopBroadcast();

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
            maxTokenCost,
            abi.encodePacked(sr, ss, sv)
        );

        // ── Owner signs ─────────────────────────────────────────────────────
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
        uint256 ddscAfter      = ddsc.balanceOf(acctAddr);
        uint256 pmDdscAfter    = ddsc.balanceOf(address(paymaster));

        console.log("");
        console.log("--- After ---");
        console.log("Counter value:     ", counter.count());
        console.log("Account ADI:       ", acctAddr.balance, "wei (still zero)");
        console.log("Account DDSC:      ", ddscAfter);
        console.log("PM native deposit: ", pmDepositAfter);
        console.log("PM DDSC collected: ", pmDdscAfter);
        console.log("");
        console.log("--- Deltas ---");
        console.log("PM native spent:   ", pmDepositBefore - pmDepositAfter, "wei");
        console.log("Account DDSC paid: ", ddscBefore - ddscAfter);
        console.log("PM DDSC received:  ", pmDdscAfter - pmDdscBefore);
        console.log("");
        console.log("SUCCESS: Gas paid by paymaster (native), account paid in DDSC (ERC20).");
    }
}

contract Counter {
    uint256 public count;
    function increment() external { count++; }
}
