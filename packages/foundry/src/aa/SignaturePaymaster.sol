// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ERC4337.sol";

/// @title SignaturePaymaster
/// @notice ERC-4337 v0.7 Paymaster that sponsors UserOperations whose gas fees
///         are pre-approved by a trusted backend "Sponsor Service".
///
/// Authorization model:
///   - The Sponsor Service holds `sponsorSigner` private key off-chain.
///   - When an eligible SME wants to call mintInvoice() with zero ADI balance,
///     they request sponsorship from the Sponsor Service.
///   - The Sponsor Service signs: keccak256(userOpHash || chainId || paymaster)
///   - The SME includes this signature in paymasterAndData[SPONSOR_SIG_OFFSET:].
///   - EntryPoint calls validatePaymasterUserOp → we verify the signature.
///   - If valid, EntryPoint deducts gas from this contract's deposit.
///
/// paymasterAndData layout (ERC-4337 v0.7):
///   [  0 : 20]  paymaster address          (20 bytes)
///   [ 20 : 36]  verification gas limit     (16 bytes, packed by bundler)
///   [ 36 : 52]  post-op gas limit          (16 bytes, packed by bundler)
///   [ 52 : 117] sponsor ECDSA signature    (65 bytes)
contract SignaturePaymaster is IPaymaster, Ownable {
    using ECDSA for bytes32;

    uint256 public constant SPONSOR_SIG_OFFSET = 52;
    uint256 public constant SIG_VALIDATION_FAILED = 1;

    address public immutable entryPoint;
    address public sponsorSigner;

    event SponsorSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event UserOperationSponsored(address indexed sender, bytes32 indexed userOpHash);
    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Paymaster: caller not EntryPoint");
        _;
    }

    constructor(address _entryPoint, address _sponsorSigner, address owner_) Ownable(owner_) {
        entryPoint   = _entryPoint;
        sponsorSigner = _sponsorSigner;
    }

    // ── IPaymaster ────────────────────────────────────────────────────────────

    /// @notice EntryPoint calls this before executing the UserOperation.
    ///         Returns validationData = 0 (success) or 1 (failure).
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /* maxCost */
    ) external override onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // Extract the 65-byte sponsor signature from paymasterAndData
        require(
            userOp.paymasterAndData.length >= SPONSOR_SIG_OFFSET + 65,
            "Paymaster: missing sponsor signature"
        );
        bytes calldata sponsorSig = userOp.paymasterAndData[SPONSOR_SIG_OFFSET:SPONSOR_SIG_OFFSET + 65];

        // Verify: sponsor signed keccak256(userOpHash || chainId || paymaster_address)
        bytes32 signedHash  = keccak256(abi.encodePacked(userOpHash, block.chainid, address(this)));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(signedHash);
        address recovered   = ECDSA.recover(ethSignedHash, sponsorSig);

        if (recovered != sponsorSigner) {
            return ("", SIG_VALIDATION_FAILED);
        }

        emit UserOperationSponsored(userOp.sender, userOpHash);
        return (abi.encode(userOp.sender), 0);
    }

    /// @notice Called after the UserOperation executes. Logs actual gas cost.
    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    ) external override onlyEntryPoint {
        address sponsored = abi.decode(context, (address));
        // Gas cost is deducted automatically from our EntryPoint deposit.
        // Future: deduct from SME's invoice proceeds here.
        emit UserOperationSponsored(sponsored, bytes32(actualGasCost));
    }

    // ── Deposit / Withdraw ────────────────────────────────────────────────────

    /// @notice Fund this paymaster's EntryPoint deposit.
    function deposit() external payable {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Owner withdraws from EntryPoint deposit.
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        IEntryPoint(entryPoint).withdrawTo(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Current EntryPoint deposit balance.
    function getDeposit() external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setSponsorSigner(address newSigner) external onlyOwner {
        emit SponsorSignerUpdated(sponsorSigner, newSigner);
        sponsorSigner = newSigner;
    }

    receive() external payable {}
}
