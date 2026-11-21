// Testnet deploy for the Agent ID Hackathon entry "Hire Rowan".
//
// Usage:
//   PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network bscTestnet
//
// By default this deploys MockUSDC + MockAgentID + AgentTaskEscrow.
// To reuse already-deployed token / registry addresses instead, set:
//   TOKEN_ADDRESS=0x... REGISTRY_ADDRESS=0x...
// Deployed addresses are written to deployments/bscTestnet.json (or the
// active network name). Never commit a private key; it comes from env only.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:   ${network.name} (chain ${network.config.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  let tokenAddress = process.env.TOKEN_ADDRESS;
  let registryAddress = process.env.REGISTRY_ADDRESS;

  if (!tokenAddress) {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    tokenAddress = await usdc.getAddress();
    const receipt = await (await usdc.deploymentTransaction()).wait();
    console.log(`MockUSDC deployed:      ${tokenAddress} (gas ${receipt.gasUsed})`);
    // Seed the deployer with mock USDC for manual testing.
    await usdc.mint(deployer.address, 10_000_000_000n); // 10,000 mUSDC (6 dp)
    console.log(`Minted 10,000 mUSDC to deployer`);
  } else {
    console.log(`Using existing token:   ${tokenAddress}`);
  }

  if (!registryAddress) {
    const MockAgentID = await ethers.getContractFactory("MockAgentID");
    const agentId = await MockAgentID.deploy();
    await agentId.waitForDeployment();
    registryAddress = await agentId.getAddress();
    const receipt = await (await agentId.deploymentTransaction()).wait();
    console.log(`MockAgentID deployed:   ${registryAddress} (gas ${receipt.gasUsed})`);
    // Mint an Agent ID to the deployer so it can use the escrow.
    await agentId.mint(deployer.address);
    console.log(`Minted Mock Agent ID #1 to deployer`);
  } else {
    console.log(`Using existing registry: ${registryAddress}`);
  }

  const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
  const escrow = await Escrow.deploy(tokenAddress, registryAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const receipt = await (await escrow.deploymentTransaction()).wait();
  console.log(`AgentTaskEscrow deployed: ${escrowAddress} (gas ${receipt.gasUsed})`);
  console.log(`  paymentToken:   ${await escrow.paymentToken()}`);
  console.log(`  agentIdRegistry: ${await escrow.agentIdRegistry()}`);
  console.log(`  REVIEW_WINDOW:  ${await escrow.REVIEW_WINDOW()} seconds (3 days)`);

  // Sanity: deployer can check in (holds a Mock Agent ID).
  if (!process.env.REGISTRY_ADDRESS) {
    const tx = await escrow.checkIn();
    await tx.wait();
    const [streak, total] = await escrow.getPresence(deployer.address);
    console.log(`Sanity checkIn OK: streak=${streak} total=${total} (gas ${tx.gasLimit})`);
  }

  const out = {
    network: network.name,
    chainId: Number(network.config.chainId),
    deployer: deployer.address,
    paymentToken: tokenAddress,
    agentIdRegistry: registryAddress,
    escrow: escrowAddress,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Addresses saved to ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
