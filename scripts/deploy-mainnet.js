// Mainnet deploy for the Agent ID Hackathon entry "Hire Rowan".
//
// Deploys ONLY the AgentTaskEscrow, wired to the REAL contracts:
//   USDC (payment token):  0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
//   Agent ID registry:     0x60b9262456de011f7d15a54cdd8c48baaa8b022f
//
// Usage:
//   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-mainnet.js --network bscMainnet
//
// DO NOT RUN without the deployer's explicit approval: this spends real BNB
// for gas on mainnet. The deployer must already hold an Agent ID to use the
// contract afterwards (claim it in the Binance app first). The contract has
// no owner/admin/withdraw — deploying it gives the deployer NO control over
// user funds. Deployed address is written to deployments/bscMainnet.json.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDC_MAINNET = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const AGENT_ID_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

async function main() {
  if (network.name !== "bscMainnet") {
    throw new Error(`Refusing to run mainnet deploy on network "${network.name}". Use --network bscMainnet.`);
  }
  const [deployer] = await ethers.getSigners();
  console.log(`Network:   ${network.name} (chain ${network.config.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:   ${ethers.formatEther(balance)} BNB`);
  if (balance < ethers.parseEther("0.002")) {
    throw new Error("Deployer balance < 0.002 BNB — not enough for deployment gas. Aborting.");
  }

  const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
  // Explicit 1 gwei gas price: mainnet is ~0.05 gwei right now and the
  // deploy costs ~1.66M gas (~0.0017 BNB at 1 gwei).
  const escrow = await Escrow.deploy(USDC_MAINNET, AGENT_ID_MAINNET, { gasPrice: 1_000_000_000n });
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const receipt = await (await escrow.deploymentTransaction()).wait();
  console.log(`AgentTaskEscrow deployed: ${escrowAddress} (gas ${receipt.gasUsed})`);
  console.log(`  paymentToken:    ${await escrow.paymentToken()}`);
  console.log(`  agentIdRegistry: ${await escrow.agentIdRegistry()}`);

  const out = {
    network: network.name,
    chainId: 56,
    deployer: deployer.address,
    paymentToken: USDC_MAINNET,
    agentIdRegistry: AGENT_ID_MAINNET,
    escrow: escrowAddress,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bscMainnet.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Addresses saved to ${file}`);
  console.log("NEXT: verify on BscScan (needs a BscScan API key) — see DEPLOY_NOTES.md.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
