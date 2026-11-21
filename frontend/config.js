/* Hire Rowan — dApp configuration.
 *
 * Set CONTRACT_ADDRESS / TESTNET_CONTRACT_ADDRESS after deployment.
 * Do NOT put any private key, seed phrase, or secret in this file.
 */
"use strict";

const CONFIG = {
  // Set to true to use the BSC testnet deployment (chain 97) instead of mainnet.
  TESTNET_MODE: false,

  // ---- Escrow contract (AgentTaskEscrow) ----
  // Mainnet (BSC, chain 56). Deployed 2026-11-21 ~08:33 WIB.
  CONTRACT_ADDRESS: "0x0DAed7A5Cb2DA406D184E735e92f59d49982852E",
  // Testnet (BSC testnet, chain 97). Deployed 2026-11-21 ~08:32 WIB.
  TESTNET_CONTRACT_ADDRESS: "0x9A79fE3465F13adB762D5f7526BeCbd8624E6632",
  // ---- Agent ID registry (ERC-721) ----
  // Real Agent ID contract on BNB Chain mainnet (SPACE ID Agent ID, name.ai).
  AGENT_ID_CONTRACT: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  // Testnet: MockAgentID deployed 2026-11-21 ~08:32 WIB.
  TESTNET_AGENT_ID_CONTRACT: "0xDbc93B23B2A6BF7923C887924417Cd471B28ba5c",
  // ---- Payment token (ERC-20) ----
  // USDC on BNB Chain mainnet.
  USDC_ADDRESS: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  // Testnet: MockUSDC deployed 2026-11-21 ~08:32 WIB.
  TESTNET_USDC_ADDRESS: "0x0DAed7A5Cb2DA406D184E735e92f59d49982852E",

  // Fallback decimals if the token contract cannot be read (USDC on BSC is 18).
  USDC_DECIMALS_FALLBACK: 18,

  // ---- Networks ----
  MAINNET: {
    chainId: 56,
    chainIdHex: "0x38",
    name: "BNB Chain mainnet (BSC)",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  TESTNET: {
    chainId: 97,
    chainIdHex: "0x61",
    name: "BSC testnet",
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
    explorer: "https://testnet.bscscan.com",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  },

  // Review window after delivery (seconds) — must match the contract's REVIEW_WINDOW.
  REVIEW_WINDOW_SECONDS: 3 * 24 * 60 * 60, // 3 days

  // How many of the newest tasks to show on the board.
  MAX_TASKS_SHOWN: 100,
};
