# Hire Rowan — Binance submission draft (fill in after mainnet deploy)

Submit before Dec 9, 2026, 08:00 UTC (15:00 WIB) via the official
Binance submission form.

## Project name
Hire Rowan

## Website
Built as a Muse web artifact (slug: hire-rowan). Public link pending
Haqi's share approval — fill in the URL here once shared.

## Contract address(es)
AgentTaskEscrow (BNB Chain mainnet): 0x0DAed7A5Cb2DA406D184E735e92f59d49982852E
Payment token: USDC 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d (18 decimals on-chain — the dApp reads decimals() dynamically)
Agent ID registry: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
Deployed 2026-11-21 ~08:33 WIB, gas 1,655,286 at 1 gwei.

## Agent ID usage description (draft)
Hire Rowan is an escrow dApp on BNB Chain where Agent ID is the gate
for everything: only addresses holding an Agent ID (checked on-chain via
balanceOf on the SPACE ID Agent ID registry
0x60b9262456de011f7d15a54cdd8c48baaa8b022f) can create tasks, claim
bounties, check in, or register as a provider. A client locks USDC in
escrow, the AI agent delivers (delivery hash + URL recorded on-chain),
and payment releases only when the client confirms delivery; a timeout
refund and a review window protect both sides. A free daily check-in
(gas only, no tokens moved) lets any Agent ID holder build an on-chain
presence streak. The contract has no owner, no admin, no pause, no
upgrade, and 0% fee — funds move only through the documented escrow
paths. The project was built by an Agent ID holder (whiteholic.ai).

## Reward receiving address
TODO: confirm with Haqi (his Agentic Wallet
0xd85Eefa5930758f50574Ea4C1f21223aa6B81349, or another address he chooses)

## Checklist before submitting
- [x] Contract deployed on BNB mainnet (0x0DAed7A5Cb2DA406D184E735e92f59d49982852E, 2026-11-21)
- [x] Source verified + open-source on BscScan (verified 2026-11-21 ~09:32 WIB via Etherscan API v2, GUID 2gf5bhzjkwtc2w4du55ttc2ztzdmwi7rcpfwpxhbjdhdibfwju, "Pass - Verified"; compiler v0.8.24, MIT, optimizer 200, EVM cancun). Contract page: https://bscscan.com/address/0x0DAed7A5Cb2DA406D184E735e92f59d49982852E#code
- [ ] Public GitHub repo pushed (needs Haqi's GitHub login)
- [x] Website built and tested end-to-end on testnet (mainnet dApp built 2026-11-21; public link pending share approval)
- [ ] At least 30 Agent ID addresses interacted (Innovation Award minimum)
- [ ] X promo post link submitted to the Community Promotion Award survey (promo post already live: https://x.com/whiteholic__/status/2123856868464587120)
