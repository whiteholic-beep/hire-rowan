// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Mock Agent ID (ERC-721) for tests and BSC testnet.
///         The real Agent ID (mainnet 0x60b9262456de011f7d15a54cdd8c48baaa8b022f)
///         is non-transferable; this mock is transferable for test convenience.
///         Anyone can mint; do NOT use on mainnet.
contract MockAgentID is ERC721 {
    uint256 private _nextTokenId = 1;

    constructor() ERC721("Mock Agent ID", "mAID") {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(to, tokenId);
    }
}
