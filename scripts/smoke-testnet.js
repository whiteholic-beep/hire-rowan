// Testnet smoke test for the deployed Hire Rowan escrow.
// Usage:
//   PRIVATE_KEY=0x... npx hardhat run scripts/smoke-testnet.js --network bscTestnet
//
// Flow: deployer checks in, creates an open bounty (100 mUSDC), a fresh
// agent wallet claims it, submits delivery, deployer confirms, agent is paid.
// Every tx sets an explicit gasPrice (1 gwei) — testnet rejects the default
// 0.05 gwei tip ("gas price below minimum").
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const GAS_PRICE = 1_000_000_000n; // 1 gwei
const AMOUNT = 100_000_000n; // 100 mUSDC (6 decimals)

async function main() {
  if (network.name !== "bscTestnet") throw new Error("testnet only");
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bscTestnet.json"), "utf8"));

  const usdc = await ethers.getContractAt("MockUSDC", dep.paymentToken);
  const agentId = await ethers.getContractAt("MockAgentID", dep.agentIdRegistry);
  const escrow = await ethers.getContractAt("AgentTaskEscrow", dep.escrow);
  console.log(`Escrow: ${dep.escrow} (deployer ${deployer.address})`);

  // 1. Free check-in as the deployer (holds Mock Agent ID #1).
  let tx = await escrow.checkIn({ gasPrice: GAS_PRICE });
  await tx.wait();
  const [streak, total] = await escrow.getPresence(deployer.address);
  console.log(`checkIn OK: streak=${streak} total=${total}`);

  // 2. Fresh agent wallet: fund with tBNB, mint it a Mock Agent ID.
  const agent = ethers.Wallet.createRandom().connect(ethers.provider);
  tx = await deployer.sendTransaction({ to: agent.address, value: ethers.parseEther("0.05"), gasPrice: GAS_PRICE });
  await tx.wait();
  tx = await agentId.mint(agent.address, { gasPrice: GAS_PRICE });
  await tx.wait();
  console.log(`Agent wallet ${agent.address} funded + Mock Agent ID minted`);

  // 3. Deployer creates an open bounty for 100 mUSDC, deadline +7 days.
  tx = await usdc.approve(dep.escrow, AMOUNT * 10n, { gasPrice: GAS_PRICE });
  await tx.wait();
  const brief = ethers.keccak256(ethers.toUtf8Bytes("Smoke test task"));
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  tx = await escrow.createTask(brief, AMOUNT, deadline, ethers.ZeroAddress, { gasPrice: GAS_PRICE });
  await tx.wait();
  console.log(`Bounty created: task 0, 100 mUSDC, deadline +7d`);

  // 4. Agent claims, submits delivery; deployer confirms; agent is paid.
  const escrowAsAgent = escrow.connect(agent);
  tx = await escrowAsAgent.claimTask(0, { gasPrice: GAS_PRICE });
  await tx.wait();
  const delivery = ethers.keccak256(ethers.toUtf8Bytes("smoke deliverable v1"));
  tx = await escrowAsAgent.submitDelivery(0, delivery, "ipfs://smoke-test", { gasPrice: GAS_PRICE });
  await tx.wait();
  tx = await escrow.confirmDelivery(0, { gasPrice: GAS_PRICE });
  await tx.wait();
  const agentBal = await usdc.balanceOf(agent.address);
  console.log(`confirmDelivery OK: agent mUSDC balance = ${agentBal} (expected ${AMOUNT})`);
  if (agentBal !== AMOUNT) throw new Error("agent was not paid the full amount");
  console.log("SMOKE TEST PASSED — full escrow flow works on BSC testnet");
}

main().catch((e) => { console.error(e); process.exit(1); });
