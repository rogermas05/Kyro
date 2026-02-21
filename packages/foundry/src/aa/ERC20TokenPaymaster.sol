// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ERC4337.sol";

/// @title ERC20TokenPaymaster
/// @notice ERC-4337 v0.7 Paymaster that sponsors gas in native token and collects
///         payment in an ERC20 token from the smart account.
///
/// Authorization binds to ALL of:
///   - Smart account address (sender)
///   - Chain ID + EntryPoint + Paymaster
///   - Validity window (validUntil, validAfter)
///   - Maximum ERC20 cost the user agreed to (maxTokenCost)
///   - Full UserOp fields (nonce, initCode, callData, gas params)
///
/// paymasterAndData layout (ERC-4337 v0.7):
///   [  0 : 20]  paymaster address          (20 bytes)
///   [ 20 : 36]  verification gas limit     (16 bytes)
///   [ 36 : 52]  post-op gas limit          (16 bytes)
///   [ 52 : 58]  validUntil                 (6 bytes, uint48)
///   [ 58 : 64]  validAfter                 (6 bytes, uint48)
///   [ 64 : 96]  maxTokenCost               (32 bytes, uint256)
///   [ 96 :161]  sponsor ECDSA signature    (65 bytes)
contract ERC20TokenPaymaster is IPaymaster, Ownable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    uint256 public constant VALIDITY_OFFSET = 52;
    uint256 public constant MAX_TOKEN_OFFSET = 64;
    uint256 public constant SPONSOR_SIG_OFFSET = 96;

    address public immutable entryPoint;
    IERC20 public immutable token;
    address public sponsorSigner;

    /// @notice Exchange rate: token-wei per native-wei (scaled 1e18).
    ///         Example: if 1 ADI = 3600 DDSC, set to 3600e18.
    uint256 public tokenPricePerNative;

    event SponsorSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ExchangeRateUpdated(uint256 oldRate, uint256 newRate);
    event UserOperationSponsored(address indexed sender, bytes32 indexed userOpHash);
    event GasSponsored(address indexed sender, uint256 actualGasCost, uint256 tokenCharge);
    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event TokensWithdrawn(address indexed to, uint256 amount);

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Paymaster: caller not EntryPoint");
        _;
    }

    constructor(
        address _entryPoint,
        address _sponsorSigner,
        address _token,
        uint256 _tokenPricePerNative,
        address owner_
    ) Ownable(owner_) {
        entryPoint = _entryPoint;
        sponsorSigner = _sponsorSigner;
        token = IERC20(_token);
        tokenPricePerNative = _tokenPricePerNative;
    }

    // ── IPaymaster ────────────────────────────────────────────────────────────

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /* maxCost */
    ) external override onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        require(
            userOp.paymasterAndData.length >= SPONSOR_SIG_OFFSET + 65,
            "Paymaster: missing sponsor signature"
        );

        uint48 validUntil = uint48(bytes6(userOp.paymasterAndData[VALIDITY_OFFSET:VALIDITY_OFFSET + 6]));
        uint48 validAfter = uint48(bytes6(userOp.paymasterAndData[VALIDITY_OFFSET + 6:VALIDITY_OFFSET + 12]));
        uint256 maxTokenCost = uint256(bytes32(userOp.paymasterAndData[MAX_TOKEN_OFFSET:MAX_TOKEN_OFFSET + 32]));
        bytes calldata sponsorSig = userOp.paymasterAndData[SPONSOR_SIG_OFFSET:SPONSOR_SIG_OFFSET + 65];

        bytes32 hash = getHash(userOp, validUntil, validAfter, maxTokenCost);
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        address recovered = ECDSA.recover(ethSignedHash, sponsorSig);

        bool sigFailed = (recovered != sponsorSigner);

        if (!sigFailed) {
            require(
                token.allowance(userOp.sender, address(this)) >= maxTokenCost,
                "Paymaster: insufficient ERC20 allowance"
            );
            require(
                token.balanceOf(userOp.sender) >= maxTokenCost,
                "Paymaster: insufficient ERC20 balance"
            );
        }

        return (
            abi.encode(userOp.sender, maxTokenCost, tokenPricePerNative),
            _packValidationData(sigFailed, validUntil, validAfter)
        );
    }

    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    ) external override onlyEntryPoint {
        (address sender, uint256 maxTokenCost, uint256 priceSnapshot) =
            abi.decode(context, (address, uint256, uint256));

        uint256 actualTokenCost = (actualGasCost * priceSnapshot) / 1e18;
        if (actualTokenCost > maxTokenCost) {
            actualTokenCost = maxTokenCost;
        }

        if (actualTokenCost > 0) {
            token.safeTransferFrom(sender, address(this), actualTokenCost);
        }

        emit GasSponsored(sender, actualGasCost, actualTokenCost);
    }

    // ── Deposit / Withdraw ────────────────────────────────────────────────────

    function deposit() external payable {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        IEntryPoint(entryPoint).withdrawTo(to, amount);
        emit Withdrawn(to, amount);
    }

    function getDeposit() external view returns (uint256) {
        return IEntryPoint(entryPoint).balanceOf(address(this));
    }

    function withdrawTokens(address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
        emit TokensWithdrawn(to, amount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setSponsorSigner(address newSigner) external onlyOwner {
        emit SponsorSignerUpdated(sponsorSigner, newSigner);
        sponsorSigner = newSigner;
    }

    function setExchangeRate(uint256 newRate) external onlyOwner {
        emit ExchangeRateUpdated(tokenPricePerNative, newRate);
        tokenPricePerNative = newRate;
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    /// @notice Compute the hash the sponsor must sign. Avoids circular dependency
    ///         by hashing UserOp fields directly (not paymasterAndData).
    function getHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter,
        uint256 maxTokenCost
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.accountGasLimits,
            userOp.preVerificationGas,
            userOp.gasFees,
            block.chainid,
            entryPoint,
            address(this),
            validUntil,
            validAfter,
            maxTokenCost
        ));
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _packValidationData(
        bool sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0)
            | (uint256(validUntil) << 160)
            | (uint256(validAfter) << 208);
    }

    receive() external payable {}
}
