// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ClaimTopicsRegistry
/// @notice Maintains the list of required claim topics for compliance.
///         Topic IDs: 1 = KYC, 2 = Accredited Investor, 3 = AML
contract ClaimTopicsRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256[] private _claimTopics;

    event ClaimTopicAdded(uint256 indexed topic);
    event ClaimTopicRemoved(uint256 indexed topic);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function addClaimTopic(uint256 topic) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < _claimTopics.length; i++) {
            require(_claimTopics[i] != topic, "Topic already exists");
        }
        _claimTopics.push(topic);
        emit ClaimTopicAdded(topic);
    }

    function removeClaimTopic(uint256 topic) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < _claimTopics.length; i++) {
            if (_claimTopics[i] == topic) {
                _claimTopics[i] = _claimTopics[_claimTopics.length - 1];
                _claimTopics.pop();
                emit ClaimTopicRemoved(topic);
                return;
            }
        }
        revert("Topic not found");
    }

    function getClaimTopics() external view returns (uint256[] memory) {
        return _claimTopics;
    }
}
