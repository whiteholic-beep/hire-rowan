# Deploy notes — Hire Rowan / AgentTaskEscrow

## Contract

`AgentTaskEscrow` (Solidity 0.8.24, optimizer 200 runs, EVM Cancun — required
because OpenZeppelin v5.6 uses the `mcopy` builtin). No owner/admin/withdraw/
pause/upgrade; protocol fee 0%. Constructor: `(address paymentToken,
address agentIdRegistry)`.

## How to deploy

Prereqs: Node 18+, `npm install` in this directory. The deployer private key
comes from the `PRIVATE_KEY` env var only — never commit a key.

```bash
# BSC testnet (chain 97) — deploys MockUSDC + MockAgentID + escrow,
# mints 10,000 mUSDC and one Mock Agent ID to the deployer, then does a
# sanity checkIn. Addresses -> deployments/bscTestnet.json
PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network bscTestnet

# Reuse existing token/registry instead of deploying mocks:
TOKEN_ADDRESS=0x... REGISTRY_ADDRESS=0x... PRIVATE_KEY=0x... \
  npx hardhat run scripts/deploy.js --network bscTestnet

# BSC mainnet (chain 56) — escrow ONLY, wired to the real contracts.
# DO NOT RUN without the deployer's explicit approval: spends real BNB.
PRIVATE_KEY=0x... npx hardhat run scripts/deploy-mainnet.js --network bscMainnet
```

## Exact constructor args

| Network | paymentToken | agentIdRegistry |
|---|---|---|
| BSC testnet (97) | `MockUSDC` deployed by `scripts/deploy.js` (address in `deployments/bscTestnet.json`) | `MockAgentID` deployed by `scripts/deploy.js` |
| BSC mainnet (56) | USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | Agent ID `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |

The mainnet deployer should already hold an Agent ID (claim in the Binance
app: Wallet > banner > Agent ID) to use the contract afterwards. Deploying
gives the deployer **no** control over user funds.

## Gas (measured on local Hardhat, `scripts/measure-gas.js`)

| Action | gasUsed |
|---|---|
| Deploy `AgentTaskEscrow` | 1,655,286 |
| Deploy `MockUSDC` | 512,782 |
| Deploy `MockAgentID` | 998,506 |
| `checkIn` (first, cold storage) | 95,808 |
| `registerProvider` | 52,226 |
| `createTask` (open bounty) | ~199,000–202,000 |
| `createTask` (direct hire) | 263,497 |
| `claimTask` | 77,302 |
| `submitDelivery` | ~109,600 |
| `confirmDelivery` | 68,232 |
| `cancelTask` | 65,701 |
| `refundAfterTimeout` | 50,730 |
| `releaseAfterReview` | 50,845 |

Cost estimates (BSC gas typically 1–3 gwei; BNB ≈ $600 — both move, recheck
at deploy time):

| Action | @ 1 gwei | @ 3 gwei |
|---|---|---|
| Deploy escrow | ~0.0017 BNB (~$1.00) | ~0.0050 BNB (~$3.00) |
| Full testnet set (3 deploys) | ~0.0032 BNB (~$1.90) | ~0.0095 BNB (~$5.70) |
| `checkIn` | ~0.00010 BNB (~$0.06) | ~0.00029 BNB (~$0.17) |
| `createTask` | ~0.00020–0.00026 BNB | ~0.00060–0.00079 BNB |

## Tests

```bash
npx hardhat test   # 49 passing, 0 failing
```

Covers: Agent ID gating (non-holder reverts on create/claim/submit/register/
check-in), create/claim/submit/confirm happy paths (open bounty + direct
hire), cancel refund, timeout refund, release-after-review, wrong-caller
reverts, event emission, a malicious-token reentrancy attempt (blocked by
`ReentrancyGuard`), and the full check-in suite (same-day revert, streak
increment on consecutive days, streak reset after a missed day, boundary
day-rollover, `getPresence` values, no token movement).

## Blockers

1. **Testnet deploy BLOCKED — no test BNB.** A testnet deployer wallet was
   generated and stored mode 600 at `.deployer-testnet.json` (gitignored):
   `0xBED2e63e427f1A5557A9A9d4Dd2FA98C9CE97E89`, balance **0 tBNB**
   (checked on-chain 2026-11-21). The BSC testnet faucet
   (`https://testnet.bnbchain.org/faucet-smart` → `bnbchain.org/en/testnet-faucet`)
   is a JS web app that requires solving a captcha in a browser — it cannot be
   claimed via curl/API. **Unblock:** Haqi (or anyone with a browser) opens
   the faucet page, solves the captcha, and sends 0.5 tBNB to
   `0xBED2e63e427f1A5557A9A9d4Dd2FA98C9CE97E89`. Then run
   `PRIVATE_KEY=$(node -e "console.log(require('./.deployer-testnet.json').privateKey)") npx hardhat run scripts/deploy.js --network bscTestnet`.
   No real funds were spent and none were requested from anyone.
2. **BscScan verification needs a BscScan API key** — not yet available. Do
   not invent one. Once available: `npx hardhat verify --network bscTestnet
   <escrow> <token> <registry>` (add `@nomicfoundation/hardhat-verify`).
3. **Mainnet deploy needs real BNB for gas** (est. ~0.005 BNB at 3 gwei for
   the escrow alone) **and Haqi's explicit approval.** Haqi's Agentic Wallet
   `0xd85Eefa5930758f50574Ea4C1f21223aa6B81349` holds ~0.055 BNB (per parent
   agent, verified on-chain 2026-11-21) — enough, but do not spend it without
   his go-ahead. Mainnet deploy was NOT run.

## Notes / gotchas found while building

- Hardhat 3's `@nomicfoundation/hardhat-chai-matchers@3.0.0` (`latest`) is a
  deprecated stub that exits on load; the project therefore uses **Hardhat
  2.26.3** with `@nomicfoundation/hardhat-ethers@3.0.9`,
  `@nomicfoundation/hardhat-chai-matchers@2.0.9`,
  `@nomicfoundation/hardhat-network-helpers@1.0.4`, `chai@4.5.0`,
  `ethers@6.17.0` (all pinned in `package.json`).
- `hardhat-network-helpers` `time.increaseTo()` mines a block immediately at
  the target timestamp; a following transaction mines 1s later — tests that
  straddle a UTC-day boundary account for this (see the check-in tests).
