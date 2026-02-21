// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ERC4337.sol";

/// @title MinimalEntryPoint
/// @notice Simplified ERC-4337 v0.7 EntryPoint for testnet / anvil deployment.
///         Handles the full UserOp lifecycle:
///           1. Validate paymaster (signature + time window)
///           2. Validate account signature
///           3. Execute callData on the sender account
///           4. Call postOp on paymaster
///           5. Deduct gas from paymaster deposit
///
/// NOT audited — for demo and development only.
/// Real deployment: use eth-infinitism/account-abstraction EntryPoint v0.7.
contract MinimalEntryPoint is IEntryPoint {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(uint192 => uint256)) private _nonces;
    uint256 private _collected; // gas compensation owed to beneficiary this batch

    // ── IEntryPoint ───────────────────────────────────────────────────────────

    function depositTo(address account) external payable override {
        balanceOf[account] += msg.value;
        emit Deposited(account, balanceOf[account]);
    }

    function withdrawTo(address payable to, uint256 amount) external override {
        require(balanceOf[msg.sender] >= amount, "EntryPoint: insufficient deposit");
        balanceOf[msg.sender] -= amount;
        to.transfer(amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function getNonce(address sender, uint192 key) external view override returns (uint256) {
        return _nonces[sender][key];
    }

    function getUserOpHash(PackedUserOperation calldata userOp) external view override returns (bytes32) {
        return keccak256(abi.encode(
            keccak256(abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )),
            block.chainid,
            address(this)
        ));
    }

    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external override {
        _collected = 0;
        for (uint256 i = 0; i < ops.length; i++) {
            _handleOp(ops[i]);
        }
        uint256 compensation = _collected;
        _collected = 0;
        if (compensation > 0) {
            beneficiary.transfer(compensation);
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _handleOp(PackedUserOperation calldata op) internal {
        bytes32 opHash = this.getUserOpHash(op);

        // 1. Deploy account via initCode if needed
        if (op.initCode.length >= 20) {
            address factory = address(bytes20(op.initCode[:20]));
            bytes memory initCallData = op.initCode[20:];
            (bool ok,) = factory.call(initCallData);
            require(ok, "EntryPoint: initCode failed");
        }

        // 2. Validate paymaster (if present)
        bytes memory pmContext;
        address pmAddr;
        if (op.paymasterAndData.length >= 20) {
            pmAddr = address(bytes20(op.paymasterAndData[:20]));
            uint256 pmValidation;
            (pmContext, pmValidation) = IPaymaster(pmAddr).validatePaymasterUserOp(op, opHash, 0);

            (bool pmSigFailed, uint48 pmValidUntil, uint48 pmValidAfter) = _parseValidationData(pmValidation);
            require(!pmSigFailed, "EntryPoint: paymaster signature failed");
            if (pmValidUntil != 0) {
                require(block.timestamp <= pmValidUntil, "EntryPoint: paymaster sponsorship expired");
            }
            require(block.timestamp >= pmValidAfter, "EntryPoint: paymaster sponsorship not yet valid");
        }

        // 3. Validate nonce — upper 192 bits are the key, lower 64 bits are the sequence
        uint192 nonceKey = uint192(op.nonce >> 64);
        uint256 nonceSeq = uint64(op.nonce);
        require(nonceSeq == _nonces[op.sender][nonceKey], "EntryPoint: invalid nonce");
        _nonces[op.sender][nonceKey]++;

        // 4. Validate account signature
        uint256 acctValidation = IAccount(op.sender).validateUserOp(op, opHash, 0);
        (bool acctSigFailed, uint48 acctValidUntil, uint48 acctValidAfter) = _parseValidationData(acctValidation);
        require(!acctSigFailed, "EntryPoint: account validation failed");
        if (acctValidUntil != 0) {
            require(block.timestamp <= acctValidUntil, "EntryPoint: account validity expired");
        }
        require(block.timestamp >= acctValidAfter, "EntryPoint: account not yet valid");

        // 5. Execute callData on the smart account
        uint256 gasStart = gasleft();
        bool execSuccess = true;
        if (op.callData.length > 0) {
            (bool success,) = op.sender.call(op.callData);
            if (!success) {
                execSuccess = false;
                emit UserOperationRevertReason(opHash, op.sender, op.nonce, "execution reverted");
            }
        }
        uint256 gasUsed = gasStart - gasleft();

        // 6. Compute gas cost and deduct from paymaster deposit
        uint256 gasCost;
        if (op.paymasterAndData.length >= 20) {
            (, uint128 maxFeePerGas) = _unpackGasFees(op.gasFees);
            gasCost = gasUsed * maxFeePerGas;
            if (balanceOf[pmAddr] >= gasCost) {
                balanceOf[pmAddr] -= gasCost;
                _collected += gasCost;
            }
            IPaymaster(pmAddr).postOp(PostOpMode.opSucceeded, pmContext, gasCost, maxFeePerGas);
        }

        emit UserOperationEvent(opHash, op.sender, pmAddr, op.nonce, execSuccess, gasCost, gasUsed);
    }

    /// @dev Parse packed validationData into its components.
    function _parseValidationData(uint256 validationData)
        internal
        pure
        returns (bool sigFailed, uint48 validUntil, uint48 validAfter)
    {
        sigFailed  = uint160(validationData) != 0;
        validUntil = uint48(validationData >> 160);
        validAfter = uint48(validationData >> 208);
    }

    /// @dev Unpack gasFees bytes32: high 128 = maxPriorityFeePerGas, low 128 = maxFeePerGas
    function _unpackGasFees(bytes32 gasFees)
        internal
        pure
        returns (uint128 maxPriorityFee, uint128 maxFee)
    {
        maxPriorityFee = uint128(uint256(gasFees) >> 128);
        maxFee = uint128(uint256(gasFees));
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event Deposited(address indexed account, uint256 totalDeposit);
    event Withdrawn(address indexed account, address withdrawAddress, uint256 amount);
    event UserOperationEvent(
        bytes32 indexed userOpHash, address indexed sender, address indexed paymaster,
        uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed
    );
    event UserOperationRevertReason(
        bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason
    );

    receive() external payable {}
}
