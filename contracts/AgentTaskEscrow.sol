// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentTaskEscrow
/// @notice Escrow for hiring Agent ID holders for small tasks, paid in an ERC-20
///         token (USDC on BNB Chain mainnet). Built for the Binance Wallet x
///         BNB Chain Agent ID Hackathon ("Hire Rowan").
/// @dev NO OWNER / NO ADMIN / NO WITHDRAW / NO PAUSE / NO UPGRADE.
///      The contract holds escrowed funds and they can ONLY move via:
///        (a) confirmDelivery  -> funds to the agent (client confirms delivery)
///        (b) cancelTask       -> funds back to the client (open bounty, pre-claim)
///        (c) refundAfterTimeout -> funds back to the client (deadline passed,
///            no delivery submitted)
///        (d) releaseAfterReview -> funds to the agent (client silent for the
///            REVIEW_WINDOW after a delivery was submitted)
///      Nobody — not the deployer, not the dApp operator, not any admin —
///      can withdraw user funds. Protocol fee is 0%.
/// @dev Every state-changing action requires the caller to hold an Agent ID:
///      balanceOf(caller) > 0 on the Agent ID registry (ERC-721) passed to the
///      constructor. Mainnet registry: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
///      (SPACE ID Agent ID, name.ai). Testnet deployments use a mock ERC-721.
/// @dev Free check-in: checkIn() is gas-only (no USDC, no fee) and records a
///      holder's daily presence with a consecutive-day streak — the free
///      front door of the dApp. It moves no tokens at all.
contract AgentTaskEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ERC-20 token used for payments (USDC on mainnet).
    address public immutable paymentToken;
    /// @notice Agent ID registry (ERC-721). Holders are the only actors.
    address public immutable agentIdRegistry;

    /// @notice Review window after a delivery: if the client neither confirms
    ///         nor disputes within this window, the agent may release funds.
    uint256 public constant REVIEW_WINDOW = 3 days;

    enum TaskStatus {
        Open, // open bounty, unclaimed
        Claimed, // agent assigned / claimed
        Delivered, // delivery submitted, awaiting client review
        Completed, // client confirmed, funds released to agent
        Cancelled, // client cancelled while Open, funds refunded
        Refunded // client refunded after deadline with no delivery
    }

    struct Task {
        uint256 id;
        address client;
        address agent; // address(0) = open bounty until claimed
        address assignee; // fixed target for direct hire, address(0) = open
        uint256 amount; // token amount (token decimals)
        bytes32 briefHash; // sha256 of the task brief text
        uint256 deadline; // unix ts: agent must deliver by this
        uint256 deliveredAt;
        bytes32 deliveryHash; // sha256 of the deliverable
        string deliveryURI; // off-chain deliverable URL (IPFS / public link)
        TaskStatus status;
    }

    uint256 private _taskCount;
    mapping(uint256 => Task) private _tasks;
    mapping(address => string) private _providerNames;

    /// @notice Presence record for the free daily check-in (see checkIn()).
    struct Presence {
        uint256 currentStreak;
        uint256 totalCheckIns;
        uint256 lastCheckInDay; // UTC day number = block.timestamp / 1 days
    }

    mapping(address => Presence) private _presence;

    event TaskCreated(
        uint256 indexed taskId,
        address indexed client,
        address indexed assignee,
        uint256 amount,
        uint256 deadline,
        bytes32 briefHash
    );
    event TaskClaimed(uint256 indexed taskId, address indexed agent);
    event DeliverySubmitted(
        uint256 indexed taskId,
        address indexed agent,
        bytes32 deliveryHash,
        string deliveryURI
    );
    event DeliveryConfirmed(uint256 indexed taskId, address indexed client, address indexed agent, uint256 amount);
    event TaskCancelled(uint256 indexed taskId, address indexed client, uint256 amount);
    event TaskRefunded(uint256 indexed taskId, address indexed client, uint256 amount);
    event FundsReleased(uint256 indexed taskId, address indexed agent, uint256 amount);
    event ProviderRegistered(address indexed provider, string name);
    event CheckedIn(address indexed holder, uint256 indexed day, uint256 streak, uint256 totalCheckIns);

    error NotAgentIdHolder(address caller);
    error InvalidAmount();
    error DeadlineNotInFuture();
    error TaskNotFound(uint256 taskId);
    error NotClient(address caller);
    error NotAgent(address caller);
    error InvalidStatus(TaskStatus current);
    error CannotClaimOwnTask();
    error AssigneeOnly(address assignee);
    error AlreadyCheckedInToday(address holder, uint256 day);

    modifier onlyAgentIdHolder() {
        if (IERC721(agentIdRegistry).balanceOf(msg.sender) == 0) {
            revert NotAgentIdHolder(msg.sender);
        }
        _;
    }

    modifier taskExists(uint256 taskId) {
        if (taskId >= _taskCount) revert TaskNotFound(taskId);
        _;
    }

    /// @param _paymentToken ERC-20 used for escrow payments (mainnet USDC:
    ///        0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d).
    /// @param _agentIdRegistry Agent ID ERC-721 registry (mainnet:
    ///        0x60b9262456de011f7d15a54cdd8c48baaa8b022f).
    constructor(address _paymentToken, address _agentIdRegistry) {
        require(_paymentToken != address(0), "payment token is zero address");
        require(_agentIdRegistry != address(0), "registry is zero address");
        paymentToken = _paymentToken;
        agentIdRegistry = _agentIdRegistry;
    }

    /// @notice Create a task and escrow `amount` of the payment token.
    /// @dev Client must approve the escrow contract for `amount` first.
    ///      Direct hire (assignee != 0) starts Claimed with agent = assignee;
    ///      open bounty (assignee == 0) starts Open.
    function createTask(
        bytes32 briefHash,
        uint256 amount,
        uint256 deadline,
        address assignee
    ) external onlyAgentIdHolder nonReentrant returns (uint256 taskId) {
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (assignee == msg.sender) revert CannotClaimOwnTask();

        taskId = _taskCount;
        _taskCount++;

        TaskStatus status = assignee == address(0) ? TaskStatus.Open : TaskStatus.Claimed;
        _tasks[taskId] = Task({
            id: taskId,
            client: msg.sender,
            agent: assignee,
            assignee: assignee,
            amount: amount,
            briefHash: briefHash,
            deadline: deadline,
            deliveredAt: 0,
            deliveryHash: bytes32(0),
            deliveryURI: "",
            status: status
        });

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        emit TaskCreated(taskId, msg.sender, assignee, amount, deadline, briefHash);
        if (assignee != address(0)) {
            emit TaskClaimed(taskId, assignee);
        }
    }

    /// @notice Claim an open bounty. Claimer must hold an Agent ID and must
    ///         not be the client. Only Open tasks can be claimed.
    function claimTask(uint256 taskId) external onlyAgentIdHolder taskExists(taskId) {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Open) revert InvalidStatus(task.status);
        if (msg.sender == task.client) revert CannotClaimOwnTask();

        task.agent = msg.sender;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(taskId, msg.sender);
    }

    /// @notice Submit a delivery for a Claimed task, before the deadline.
    ///         Only the assigned agent may submit.
    function submitDelivery(
        uint256 taskId,
        bytes32 deliveryHash,
        string calldata deliveryURI
    ) external onlyAgentIdHolder taskExists(taskId) {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Claimed) revert InvalidStatus(task.status);
        if (msg.sender != task.agent) revert NotAgent(msg.sender);
        if (block.timestamp > task.deadline) revert InvalidStatus(task.status);

        task.deliveryHash = deliveryHash;
        task.deliveryURI = deliveryURI;
        task.deliveredAt = block.timestamp;
        task.status = TaskStatus.Delivered;

        emit DeliverySubmitted(taskId, msg.sender, deliveryHash, deliveryURI);
    }

    /// @notice Client confirms the delivery; escrowed funds go to the agent.
    function confirmDelivery(uint256 taskId) external taskExists(taskId) nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Delivered) revert InvalidStatus(task.status);
        if (msg.sender != task.client) revert NotClient(msg.sender);

        task.status = TaskStatus.Completed;
        IERC20(paymentToken).safeTransfer(task.agent, task.amount);

        emit DeliveryConfirmed(taskId, msg.sender, task.agent, task.amount);
    }

    /// @notice Client cancels an Open (unclaimed) task; funds refunded.
    function cancelTask(uint256 taskId) external taskExists(taskId) nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Open) revert InvalidStatus(task.status);
        if (msg.sender != task.client) revert NotClient(msg.sender);

        task.status = TaskStatus.Cancelled;
        IERC20(paymentToken).safeTransfer(task.client, task.amount);

        emit TaskCancelled(taskId, msg.sender, task.amount);
    }

    /// @notice Client reclaims funds when the deadline passed with no delivery.
    function refundAfterTimeout(uint256 taskId) external taskExists(taskId) nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Claimed) revert InvalidStatus(task.status);
        if (msg.sender != task.client) revert NotClient(msg.sender);
        if (block.timestamp <= task.deadline) revert InvalidStatus(task.status);

        task.status = TaskStatus.Refunded;
        IERC20(paymentToken).safeTransfer(task.client, task.amount);

        emit TaskRefunded(taskId, msg.sender, task.amount);
    }

    /// @notice Agent releases funds when the client is silent for REVIEW_WINDOW
    ///         (3 days) after a delivery was submitted.
    function releaseAfterReview(uint256 taskId) external taskExists(taskId) nonReentrant {
        Task storage task = _tasks[taskId];
        if (task.status != TaskStatus.Delivered) revert InvalidStatus(task.status);
        if (msg.sender != task.agent) revert NotAgent(msg.sender);
        if (block.timestamp < task.deliveredAt + REVIEW_WINDOW) revert InvalidStatus(task.status);

        task.status = TaskStatus.Completed;
        IERC20(paymentToken).safeTransfer(task.agent, task.amount);

        emit FundsReleased(taskId, msg.sender, task.amount);
    }

    /// @notice Register a display name for a provider (agent) profile.
    function registerProvider(string calldata name) external onlyAgentIdHolder {
        require(bytes(name).length > 0, "name is empty");
        _providerNames[msg.sender] = name;
        emit ProviderRegistered(msg.sender, name);
    }

    /// @notice Free daily check-in for Agent ID holders: gas only, no USDC,
    ///         no fee, no admin involvement. One check-in per UTC day
    ///         (day = block.timestamp / 1 days). Tracks a consecutive-day
    ///         streak, total check-ins and the last day checked in.
    ///         Streak increments if the previous UTC day was checked in,
    ///         otherwise it resets to 1. This is the free front door of the
    ///         dApp: a real presence/reputation record, not a fake interaction.
    function checkIn() external onlyAgentIdHolder {
        uint256 day = block.timestamp / 1 days;
        Presence storage presence = _presence[msg.sender];
        if (presence.lastCheckInDay == day) {
            revert AlreadyCheckedInToday(msg.sender, day);
        }
        uint256 streak = presence.lastCheckInDay == day - 1 ? presence.currentStreak + 1 : 1;
        presence.currentStreak = streak;
        presence.totalCheckIns += 1;
        presence.lastCheckInDay = day;

        emit CheckedIn(msg.sender, day, streak, presence.totalCheckIns);
    }

    /// @notice Presence record of a holder: current streak, total check-ins,
    ///         and the UTC day number of the last check-in (0 = never).
    function getPresence(
        address holder
    )
        external
        view
        returns (uint256 currentStreak, uint256 totalCheckIns, uint256 lastCheckInDay)
    {
        Presence storage presence = _presence[holder];
        return (presence.currentStreak, presence.totalCheckIns, presence.lastCheckInDay);
    }

    /// @notice Full task record for a task id.
    function getTask(uint256 taskId) external view taskExists(taskId) returns (Task memory) {
        return _tasks[taskId];
    }

    /// @notice Number of tasks created so far (next task id).
    function taskCount() external view returns (uint256) {
        return _taskCount;
    }

    /// @notice Registered provider display name (empty string if none).
    function providerName(address provider) external view returns (string memory) {
        return _providerNames[provider];
    }
}
