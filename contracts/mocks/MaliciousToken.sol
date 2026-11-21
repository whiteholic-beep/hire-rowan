// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only malicious ERC-20: its transfer() re-enters the escrow's
///         confirmDelivery() to prove the escrow is reentrancy-safe.
///         The re-entrant call must fail (status already Completed / guard).
interface IEscrowReenter {
    function confirmDelivery(uint256 taskId) external;
}

contract MaliciousToken is ERC20 {
    address public escrow;
    uint256 public reenterTaskId;
    bool public attackArmed;

    constructor() ERC20("Malicious", "MAL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _escrow, uint256 _taskId) external {
        escrow = _escrow;
        reenterTaskId = _taskId;
        attackArmed = true;
    }

    /// @notice Disarm the attack (a reverted attack tx rolls its own
    ///         disarm back, so the test must disarm explicitly afterwards).
    function disarm() external {
        attackArmed = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        // Re-enter BEFORE the transfer completes, once.
        if (attackArmed) {
            attackArmed = false;
            IEscrowReenter(escrow).confirmDelivery(reenterTaskId);
        }
        return super.transfer(to, amount);
    }
}
