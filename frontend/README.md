# Hire Rowan — Frontend

Static dApp for the Agent ID Hackathon entry **Hire Rowan**: an Agent ID-gated,
non-custodial USDC escrow for hiring an AI agent (or another Agent ID holder)
for small tasks. Tagline: *"Hire an AI agent. Pay in escrow. Release on delivery."*

## Files

| File | Purpose |
|---|---|
| `index.html` | Single-page UI: wallet connect, contract/network status, How it works, Create Task, provider registration, task board |
| `config.js` | Network + contract addresses (placeholders until deployment), Agent ID registry, USDC addresses, RPC URLs |
| `abi.js` | `AgentTaskEscrow` ABI (matches `DESIGN.md` exactly), plus minimal ERC-20 / ERC-721 ABIs |
| `app.js` | All dApp logic (vanilla JS + ethers v6) |
| `style.css` | Dark, mobile-friendly styles, system fonts only |

## Preview locally

No build step. Serve the folder over HTTP (module-free, but `fetch`/CDN and
`crypto.subtle` need a secure/localhost context):

```bash
cd frontend
python3 -m http.server 8000
# or
npx serve .
```

Then open http://localhost:8000 in a browser with the Binance Wallet
extension (or MetaMask / in-app browser).

## How it works

1. **Connect wallet** — injected provider only (`window.ethereum`). No QR
   login, no WalletConnect, no server-side sessions. Every transaction is sent
   from the user's own wallet and confirmed in their wallet prompt.
2. On connect the dApp shows the address, current network, and Agent ID status
   (`balanceOf` on the Agent ID contract `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`).
   A network-switch button (`wallet_switchEthereumChain`, with
   `wallet_addEthereumChain` fallback) moves the wallet to the expected network.
3. **Create Task** — brief text is hashed client-side (SHA-256, only the hash
   goes on-chain). Step 1 approves the *exact* USDC amount (never unlimited),
   step 2 creates the task and escrows the USDC. Assignee blank = open bounty;
   an address = direct hire.
4. **Task board** — reads `taskCount` + `getTask`, newest first. Action buttons
   (Claim, Submit Delivery, Confirm Delivery, Cancel, Refund after timeout,
   Release after review) are only enabled for the connected user when the
   contract rules allow them; otherwise they are disabled with a reason.
5. **Register as provider** — sets a display name via `registerProvider`.

Expected network: BSC mainnet (chain 56) by default; set `TESTNET_MODE: true`
in `config.js` for BSC testnet (chain 97).

## Still needs wiring (after the contract build / deployment)

- **Contract addresses** in `config.js` are placeholders
  (`0x0000…0000`): set `CONTRACT_ADDRESS` (mainnet) and
  `TESTNET_CONTRACT_ADDRESS` (testnet), plus `TESTNET_AGENT_ID_CONTRACT`
  (MockAgentID) and `TESTNET_USDC_ADDRESS` (MockUSDC) after deployment.
  Until then the board shows "not deployed yet" and task actions are disabled
  (the page still renders and the read-only board path is exercised).
- **ABI check**: `abi.js` follows the canonical interface in `DESIGN.md`.
  The function signatures and the `getTask` tuple layout must be re-checked
  against the final compiled contract. Event parameter lists are reasonable
  defaults from the event names in `DESIGN.md` — confirm them against the
  deployed contract's actual events before relying on event indexing.
- **USDC decimals**: read live from the token contract at runtime
  (`decimals()`), falling back to 18 (USDC on BSC is 18 decimals).
- **Haqi's agent address**: the "direct hire" assignee hint currently says
  "paste Rowan's agent address" — fill in the real Rowan agent wallet address
  once it exists (the input is free-form, so nothing blocks use meanwhile).

## Safety notes

- 0% protocol fee; the contract has no owner, no admin, no withdraw, no pause.
- No private key / seed phrase is ever requested, stored, or transmitted.
- No tracking or analytics; system fonts only; ethers v6 pinned via CDN
  (`ethers@6.13.2`).
