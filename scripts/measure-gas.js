// One-off gas measurement: deploys everything on the local Hardhat network,
// runs one full task lifecycle + a check-in, and prints actual gasUsed.
// Not part of the deploy flow. Run: npx hardhat run scripts/measure-gas.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer, client, agent] = await ethers.getSigners();
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  const MockAgentID = await ethers.getContractFactory("MockAgentID");
  const agentId = await MockAgentID.deploy();
  const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
  const escrow = await Escrow.deploy(await usdc.getAddress(), await agentId.getAddress());
  const report = async (label, txPromise) => {
    const receipt = await (await txPromise).wait();
    console.log(`${label.padEnd(28)} gasUsed ${receipt.gasUsed}`);
  };
  await report("deploy MockUSDC", usdc.deploymentTransaction());
  await report("deploy MockAgentID", agentId.deploymentTransaction());
  await report("deploy AgentTaskEscrow", escrow.deploymentTransaction());

  await agentId.mint(client.address);
  await agentId.mint(agent.address);
  await usdc.mint(client.address, 1_000_000_000n);
  await usdc.connect(client).approve(await escrow.getAddress(), 1_000_000_000n);

  await report("checkIn (first)", escrow.connect(client).checkIn());
  await report("registerProvider", escrow.connect(agent).registerProvider("Rowan"));
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * 86400;
  const brief = ethers.keccak256(ethers.toUtf8Bytes("brief"));
  await report(
    "createTask (open bounty)",
    escrow.connect(client).createTask(brief, 100_000_000n, deadline, ethers.ZeroAddress)
  );
  await report("claimTask", escrow.connect(agent).claimTask(0));
  const delivery = ethers.keccak256(ethers.toUtf8Bytes("work"));
  await report(
    "submitDelivery",
    escrow.connect(agent).submitDelivery(0, delivery, "ipfs://deliverable")
  );
  await report("confirmDelivery", escrow.connect(client).confirmDelivery(0));

  // Second task: open bounty, then cancel it (refund path).
  await report(
    "createTask (open bounty #2)",
    escrow.connect(client).createTask(brief, 100_000_000n, deadline, ethers.ZeroAddress)
  );
  await report("cancelTask", escrow.connect(client).cancelTask(1));

  // Third task: direct hire, let the deadline pass, then refund.
  await report(
    "createTask (direct hire)",
    escrow.connect(client).createTask(brief, 100_000_000n, deadline, agent.address)
  );
  await ethers.provider.send("evm_increaseTime", [8 * 86400]);
  await ethers.provider.send("evm_mine");
  await report("refundAfterTimeout", escrow.connect(client).refundAfterTimeout(2));

  // Fourth task: direct hire, deliver, wait out the review window, release.
  const deadline2 = (await ethers.provider.getBlock("latest")).timestamp + 7 * 86400;
  await report(
    "createTask (direct hire #2)",
    escrow.connect(client).createTask(brief, 100_000_000n, deadline2, agent.address)
  );
  await report(
    "submitDelivery #2",
    escrow.connect(agent).submitDelivery(3, delivery, "ipfs://deliverable")
  );
  await ethers.provider.send("evm_increaseTime", [3 * 86400 + 1]);
  await ethers.provider.send("evm_mine");
  await report("releaseAfterReview", escrow.connect(agent).releaseAfterReview(3));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
