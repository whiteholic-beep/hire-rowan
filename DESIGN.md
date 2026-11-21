# Hire Rowan — Agent ID Hackathon Entry

## Project
**Name:** Hire Rowan (contract: `AgentTaskEscrow`)
**Hackathon:** Binance Wallet x BNB Chain Agent ID Hackathon
**Deadline to submit:** Dec 9, 2026, 08:00 UTC (15:00 WIB)
**Pool:** $60,000 USDC. Pioneer Award ($29k, on-chain metrics) + Innovation Award
($29k, judged; requires >= 30 Agent ID addresses interacting during submission period).

## What it does
An escrow dApp where Agent ID holders hire an AI agent ("Rowan") or each other
for small tasks, paying in USDC held in escrow on BNB Chain.
- **Idea A (Hire Rowan):** client creates a task assigned to a specific agent
  address (e.g. Rowan's agent wallet). Agent submits a delivery (hash + URL),
  client confirms -> USDC released.
- **Idea C (micro-bounty board):** same contract, task with assignee == address(0)
  is an open bounty any Agent ID holder can claim and complete.

## Free front door — Agent ID check-in (presence)
A gas-only, no-USDC interaction so real Agent ID holders can use the product
without spending money — the low-friction front door that makes reaching 30
interacting holders feasible. It is a real feature (presence + reputation),
not a fake interaction:
- `checkIn()` — caller must hold an Agent ID; records the holder's presence
  for the current UTC day, once per day. Tracks per-address `currentStreak`
  (consecutive days), `totalCheckIns`, `lastCheckInDay`.
- View: `getPresence(address) returns (uint256 currentStreak, uint256 totalCheckIns, uint256 lastCheckInDay)`.
- Event: `CheckedIn(address indexed holder, uint256 indexed day, uint256 streak, uint256 totalCheckIns)`.
- Costs only BNB gas (~a cent). No USDC, no fee, no admin involvement.
- The frontend makes check-in the most prominent action: a "Check in today"
  card at the top showing the holder's streak and total check-ins.

## Agent ID integration
- Agent ID contract (BNB Chain mainnet): `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`
  (SPACE ID Agent ID, ERC-721, non-transferable, `name.ai`).
- Holder check: `balanceOf(address) > 0` on that contract. Every state-changing
  action (create task, claim, submit delivery, register provider) requires the
  caller to hold an Agent ID.
- On BSC testnet the Agent ID contract does NOT exist, so the escrow contract
  takes the registry address as a constructor parameter and testnet deploys use
  a `MockAgentID` ERC-721. Mainnet deploy uses the real address above.
- Frontend shows Agent ID status of the connected wallet (holds / does not hold).

## Payment token
- Constructor parameter `paymentToken` (ERC-20). Mainnet: USDC on BNB Chain
  `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`. Testnet: deploy a `MockUSDC`.
- Protocol fee: **0%**. No fee, no admin cut.

## Owner permissions — NONE over user funds
- The contract has **no owner, no admin role, no withdraw function, no pause,
  no upgrade**. Funds can only move via: (a) client confirms delivery ->
  agent, (b) client cancels before acceptance -> client, (c) refund after
  deadline/review timeout -> client, (d) agent release after review window
  expires -> agent. Nobody — not the deployer, not Rowan — can withdraw user
  funds. This is documented in README and in NatSpec.

## Contract interface (canonical — frontend must match this exactly)
```solidity
enum TaskStatus { Open, Claimed, Delivered, Completed, Cancelled, Refunded }

struct Task {
    uint256 id;
    address client;
    address agent;          // address(0) = open bounty until claimed
    address assignee;       // fixed target for direct hire, address(0) = open
    uint256 amount;         // USDC amount (token decimals)
    bytes32 briefHash;      // sha256 of the task brief text
    uint256 deadline;       // unix ts: agent must deliver by this
    uint256 deliveredAt;
    bytes32 deliveryHash;   // sha256 of the deliverable
    string  deliveryURI;    // off-chain deliverable URL (IPFS / public link)
    TaskStatus status;
}

function createTask(bytes32 briefHash, uint256 amount, uint256 deadline, address assignee) external returns (uint256 taskId);
function claimTask(uint256 taskId) external;
function submitDelivery(uint256 taskId, bytes32 deliveryHash, string calldata deliveryURI) external;
function confirmDelivery(uint256 taskId) external;
function cancelTask(uint256 taskId) external;
function refundAfterTimeout(uint256 taskId) external;
function releaseAfterReview(uint256 taskId) external;
function registerProvider(string calldata name) external;
function checkIn() external;
function getPresence(address holder) external view returns (uint256 currentStreak, uint256 totalCheckIns, uint256 lastCheckInDay);
function getTask(uint256 taskId) external view returns (Task memory);
function taskCount() external view returns (uint256);
function providerName(address) external view returns (string memory);
function agentIdRegistry() external view returns (address);
function paymentToken() external view returns (address);
```
- `REVIEW_WINDOW = 3 days`: after delivery, if the client neither confirms nor
  disputes within 3 days, the agent may call `releaseAfterReview`.
- `createTask`: client must hold Agent ID; `amount > 0`; `deadline > now`;
  escrows `amount` via `transferFrom` (client must approve first).
- `claimTask`: open bounty only, claimer must hold Agent ID and != client.
- `submitDelivery`: only the assigned/claiming agent, before deadline,
  status Claimed (or Open with fixed assignee — direct-hire tasks start
  Claimed by the assignee).
- `confirmDelivery`: only client, status Delivered -> releases funds to agent.
- `cancelTask`: only client, only while Open/unclaimed -> refund.
- `refundAfterTimeout`: only client; if no delivery by deadline, or delivery
  submitted but client disputes by... (simplest: after deadline with no
  delivery, client reclaims; if delivery exists, client must confirm or the
  agent releases after review window — no separate dispute function; a client
  who is unhappy simply does not confirm and the agent can only release after
  the review window, which is the documented trade-off).
- Events: `TaskCreated`, `TaskClaimed`, `DeliverySubmitted`, `DeliveryConfirmed`,
  `TaskCancelled`, `TaskRefunded`, `FundsReleased`, `ProviderRegistered`,
  `CheckedIn`.
- `checkIn`: caller must hold Agent ID; one check-in per UTC day (day =
  `block.timestamp / 1 days`); streak increments if yesterday was checked in,
  else resets to 1; updates `totalCheckIns` and `lastCheckInDay`; emits
  `CheckedIn`. Gas-only, no token movement.

## Safety red lines (hackathon rules — must not violate)
- No QR-code login for Agentic Wallet. Frontend connects ONLY via injected
  provider (`window.ethereum` — Binance Wallet extension / in-app browser).
  No session storage server-side, no placing orders on users' behalf.
- Every asset operation requires the user's own wallet confirmation
  (standard MetaMask/Binance Wallet signing prompts). No bypass.
- No unauthorized transfers, no scheduled collection, no bundled extra
  transfers, no unlimited approvals solicited.
- No Binance/BNB branding in project name or domain.
- No collecting seed phrases, private keys, API secrets, pairing codes.
- No promises of returns ("passive income", "automatic money-making").
- No wallet-lookup-by-name tool.

## Stack
- Hardhat + ethers v6 + OpenZeppelin contracts (ReentrancyGuard, SafeERC20).
- Solidity 0.8.24. Networks: BSC testnet (97) then BSC mainnet (56).
- Frontend: static site (vanilla JS + ethers v6 via CDN), hosted publicly.
- Repo: public GitHub (push step pending — no credentials on VM yet).

## Directory layout
```
agent-id-hackathon/
  DESIGN.md            (this file)
  README.md
  contracts/           (AgentTaskEscrow.sol, MockUSDC.sol, MockAgentID.sol)
  test/                (hardhat tests)
  scripts/             (deploy testnet/mainnet, verify)
  hardhat.config.js
  frontend/            (static dApp: index.html, app.js, abi.js, style.css)
  docs/                (submission notes)
```

## Status
- [x] Design written
- [ ] Contract + tests (in progress — subagent)
- [x] Frontend (built — subagent; check-in UI update pending)
- [ ] Free check-in added to contract + frontend (in progress — design update 2026-11-21)
- [ ] Testnet deploy + test
- [ ] Mainnet deploy (needs real BNB for gas — NOT spent yet; Haqi's Agentic Wallet 0xd85Eefa5930758f50574Ea4C1f21223aa6B81349 holds ~0.055 BNB, deploy spend needs his explicit approval)
- [ ] BscScan verification (needs BscScan API key — not yet available)
- [ ] Public repo push (needs GitHub credentials — not yet available)
- [ ] Public website hosting
- [x] Haqi claimed his Agent ID: **whiteholic.ai** (gold card), wallet 0xd85Eefa5930758f50574Ea4C1f21223aa6B81349, verified on-chain balanceOf = 1 (2026-11-21 ~02:00 WIB)
- [ ] Promotion to reach 30 Agent ID holders (free check-in is the front door)
- [ ] Submission to Binance (parent does this with Haqi — NOT this task)
