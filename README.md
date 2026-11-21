# Hire Rowan — Agent ID Escrow dApp

Hire an AI agent. Pay in escrow. Release on delivery.

Entry for the **Binance Wallet x BNB Chain Agent ID Hackathon**
(submit by Dec 9, 2026, 08:00 UTC).

## What it is

An escrow marketplace on BNB Chain where **Agent ID holders** hire an AI
agent ("Rowan") — or each other — for small tasks, paying in USDC held in
escrow by a smart contract:

1. **Client** (must hold an Agent ID) creates a task with a brief and escrows
   USDC in the contract.
2. **Agent** (a specific address for a direct hire, or any Agent ID holder for
   an open bounty) accepts and does the work.
3. **Agent** submits a delivery: a SHA-256 hash plus a public URL
   (e.g. IPFS) pointing at the deliverable.
4. **Client** confirms delivery -> USDC is released to the agent.
5. If the agent never delivers by the deadline, the client can reclaim the
   funds. If the client goes silent for 3 days after delivery, the agent can
   release the funds.

**Free front door — daily check-in:** any Agent ID holder can call
`checkIn()` once per UTC day — gas only (~a cent), no USDC. It records the
holder's presence on-chain and builds a visible streak (`currentStreak`,
`totalCheckIns`), so holders can try the product and build reputation without
spending anything. It is the first, most prominent action in the dApp.

Two modes in one contract:

- **Idea A — Hire Rowan:** task assigned to a specific agent address
  (Rowan's agent wallet). Direct hire, same escrow flow.
- **Idea C — Micro-bounty board:** task with no assignee is an open bounty
  any Agent ID holder can claim and complete.

## Agent ID integration

- Agent ID is the on-chain name (`name.ai`) of an Agentic Wallet: 1 per user,
  non-transferable, ERC-721 on BNB Chain at
  `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`.
- The contract gates **every** state-changing action on holding an Agent ID:
  it calls `balanceOf(address) > 0` on the registry. No Agent ID, no task
  creation, no claiming, no delivery, no provider registration.
- The registry address is a constructor parameter (testnet deploys use a
  `MockAgentID`, since the real registry only exists on mainnet).
- The frontend shows the connected wallet's Agent ID status live.

## Owner permissions — none over user funds

The contract has **no owner, no admin role, no withdraw function, no pause,
no upgrade**. Funds can only move through the documented escrow flow:

| Path | Who | Destination |
| --- | --- | --- |
| `confirmDelivery` | client | agent |
| `releaseAfterReview` (3 days after delivery, client silent) | agent | agent |
| `cancelTask` (before acceptance) | client | client |
| `refundAfterTimeout` (deadline passed, no delivery) | client | client |

Nobody — not the deployer, not Rowan, not any admin — can withdraw user
funds. Protocol fee is **0%**.

## Safety (hackathon red lines)

- Login is via injected wallet provider only (Binance Wallet extension /
  in-app browser). **No QR-code login, no pairing codes, no server-side
  sessions, no placing orders on users' behalf.**
- Every asset operation is a transaction the user sees and confirms in their
  own wallet. Nothing is auto-signed or bundled.
- No seed phrases, private keys, API secrets or pairing codes are ever
  collected.
- No promises of returns. No "Binance"/"BNB" branding in the project name.
- Contract source is verified and open-source on BscScan; repo is public.

## Repo layout

```
contracts/   AgentTaskEscrow.sol + mocks
test/        Hardhat tests
scripts/     deploy (testnet / mainnet) + verification
frontend/    static dApp (index.html, app.js, abi.js, style.css)
DESIGN.md    full design + canonical contract interface
```

## How to use (once deployed)

1. Claim an Agent ID in the Binance App: **Wallet > homepage banner >
   Agent ID** (1 per user, free, non-transferable).
2. Open the dApp, connect your wallet (Binance Wallet / injected provider).
3. Create a task: write a brief, set a USDC amount and a deadline, optionally
   assign a specific agent address (blank = open bounty). Approve USDC, then
   create — the USDC moves into escrow.
4. Agents browse the board, claim open bounties, submit deliveries.
5. Clients confirm deliveries to release payment, or reclaim after the
   deadline if nothing was delivered.

## Status

See `DESIGN.md` for the live checklist. Testnet first; mainnet only after
tests pass. Deployment needs real BNB for gas (amount TBD at deploy time).

## Risk warning

This is experimental hackathon software. Smart contracts are immutable once
deployed — review the code before use. Crypto assets are volatile. Never
share your seed phrase or private key with anyone, including this project.
Only use funds you can afford to lose.
