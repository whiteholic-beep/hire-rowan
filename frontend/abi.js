/* Hire Rowan — contract ABIs.
 *
 * AgentTaskEscrow ABI matches the canonical interface in DESIGN.md exactly.
 * Event signatures follow the DESIGN.md event names; if the deployed contract
 * changes an event's parameters, update the matching entry here.
 * ERC-20 / ERC-721 fragments are the minimal interfaces the dApp needs.
 */
"use strict";

const ESCROW_ABI = [
  // --- Writes ---
  "function createTask(bytes32 briefHash, uint256 amount, uint256 deadline, address assignee) returns (uint256 taskId)",
  "function claimTask(uint256 taskId)",
  "function submitDelivery(uint256 taskId, bytes32 deliveryHash, string deliveryURI)",
  "function confirmDelivery(uint256 taskId)",
  "function cancelTask(uint256 taskId)",
  "function refundAfterTimeout(uint256 taskId)",
  "function releaseAfterReview(uint256 taskId)",
  "function registerProvider(string name)",
  "function checkIn()",

  // --- Reads ---
  "function getPresence(address holder) view returns (uint256 currentStreak, uint256 totalCheckIns, uint256 lastCheckInDay)",
  "function getTask(uint256 taskId) view returns (tuple(uint256 id, address client, address agent, address assignee, uint256 amount, bytes32 briefHash, uint256 deadline, uint256 deliveredAt, bytes32 deliveryHash, string deliveryURI, uint8 status))",
  "function taskCount() view returns (uint256)",
  "function providerName(address) view returns (string)",
  "function agentIdRegistry() view returns (address)",
  "function paymentToken() view returns (address)",

  // --- Events ---
  "event TaskCreated(uint256 indexed taskId, address indexed client, address indexed assignee, uint256 amount, bytes32 briefHash, uint256 deadline)",
  "event TaskClaimed(uint256 indexed taskId, address indexed agent)",
  "event DeliverySubmitted(uint256 indexed taskId, bytes32 deliveryHash, string deliveryURI)",
  "event DeliveryConfirmed(uint256 indexed taskId, address indexed agent, uint256 amount)",
  "event TaskCancelled(uint256 indexed taskId)",
  "event TaskRefunded(uint256 indexed taskId, address indexed client, uint256 amount)",
  "event FundsReleased(uint256 indexed taskId, address indexed agent, uint256 amount)",
  "event ProviderRegistered(address indexed provider, string name)",
  "event CheckedIn(address indexed holder, uint256 indexed day, uint256 streak, uint256 totalCheckIns)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];
