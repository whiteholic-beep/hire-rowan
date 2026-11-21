const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ZERO = ethers.ZeroAddress;
const DAY = 24 * 60 * 60;
const AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const BRIEF = ethers.keccak256(ethers.toUtf8Bytes("Build a landing page"));
const DELIVERY = ethers.keccak256(ethers.toUtf8Bytes("deliverable v1"));

describe("AgentTaskEscrow", function () {
  let escrow, usdc, agentId;
  let deployer, client, agent, other, stranger;

  async function deadlineIn(days) {
    return (await time.latest()) + days * DAY;
  }

  beforeEach(async function () {
    [deployer, client, agent, other, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    const MockAgentID = await ethers.getContractFactory("MockAgentID");
    agentId = await MockAgentID.deploy();

    const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
    escrow = await Escrow.deploy(await usdc.getAddress(), await agentId.getAddress());

    // Agent IDs for the actors (stranger gets none on purpose)
    await agentId.mint(client.address);
    await agentId.mint(agent.address);
    await agentId.mint(other.address);

    // Fund the client and approve the escrow
    await usdc.mint(client.address, AMOUNT * 10n);
    await usdc.connect(client).approve(await escrow.getAddress(), AMOUNT * 10n);
  });

  async function createOpenBounty(amount = AMOUNT) {
    const deadline = await deadlineIn(7);
    const tx = await escrow.connect(client).createTask(BRIEF, amount, deadline, ZERO);
    const receipt = await tx.wait();
    const taskId = 0n; // first task in a fresh fixture
    return { tx, receipt, deadline, taskId };
  }

  async function createDirectHire(amount = AMOUNT) {
    const deadline = await deadlineIn(7);
    await escrow.connect(client).createTask(BRIEF, amount, deadline, agent.address);
    return { deadline, taskId: 0n };
  }

  describe("deployment", function () {
    it("exposes paymentToken and agentIdRegistry", async function () {
      expect(await escrow.paymentToken()).to.equal(await usdc.getAddress());
      expect(await escrow.agentIdRegistry()).to.equal(await agentId.getAddress());
      expect(await escrow.REVIEW_WINDOW()).to.equal(3n * 24n * 60n * 60n);
      expect(await escrow.taskCount()).to.equal(0);
    });

    it("reverts on zero addresses in constructor", async function () {
      const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
      await expect(Escrow.deploy(ZERO, await agentId.getAddress())).to.be.revertedWith(
        "payment token is zero address"
      );
      await expect(Escrow.deploy(await usdc.getAddress(), ZERO)).to.be.revertedWith(
        "registry is zero address"
      );
    });
  });

  describe("Agent ID gating", function () {
    it("non-holder cannot create a task", async function () {
      await expect(
        escrow.connect(stranger).createTask(BRIEF, AMOUNT, await deadlineIn(7), ZERO)
      ).to.be.revertedWithCustomError(escrow, "NotAgentIdHolder");
    });

    it("non-holder cannot claim a task", async function () {
      await createOpenBounty();
      await expect(escrow.connect(stranger).claimTask(0)).to.be.revertedWithCustomError(
        escrow,
        "NotAgentIdHolder"
      );
    });

    it("non-holder cannot register as a provider", async function () {
      await expect(escrow.connect(stranger).registerProvider("Stranger")).to.be.revertedWithCustomError(
        escrow,
        "NotAgentIdHolder"
      );
    });

    it("non-holder cannot submit a delivery", async function () {
      await createDirectHire();
      await expect(
        escrow.connect(stranger).submitDelivery(0, DELIVERY, "ipfs://x")
      ).to.be.revertedWithCustomError(escrow, "NotAgentIdHolder");
    });
  });

  describe("createTask", function () {
    it("open bounty: escrows funds, status Open, emits TaskCreated", async function () {
      const deadline = await deadlineIn(7);
      await expect(escrow.connect(client).createTask(BRIEF, AMOUNT, deadline, ZERO))
        .to.emit(escrow, "TaskCreated")
        .withArgs(0, client.address, ZERO, AMOUNT, deadline, BRIEF);

      const task = await escrow.getTask(0);
      expect(task.client).to.equal(client.address);
      expect(task.agent).to.equal(ZERO);
      expect(task.assignee).to.equal(ZERO);
      expect(task.amount).to.equal(AMOUNT);
      expect(task.status).to.equal(0); // Open
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
      expect(await escrow.taskCount()).to.equal(1);
    });

    it("direct hire: starts Claimed with agent = assignee, emits TaskClaimed", async function () {
      const deadline = await deadlineIn(7);
      await expect(escrow.connect(client).createTask(BRIEF, AMOUNT, deadline, agent.address))
        .to.emit(escrow, "TaskClaimed")
        .withArgs(0, agent.address);
      const task = await escrow.getTask(0);
      expect(task.status).to.equal(1); // Claimed
      expect(task.agent).to.equal(agent.address);
      expect(task.assignee).to.equal(agent.address);
    });

    it("reverts on amount == 0", async function () {
      await expect(
        escrow.connect(client).createTask(BRIEF, 0, await deadlineIn(7), ZERO)
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts on deadline in the past", async function () {
      const past = (await time.latest()) - 1;
      await expect(
        escrow.connect(client).createTask(BRIEF, AMOUNT, past, ZERO)
      ).to.be.revertedWithCustomError(escrow, "DeadlineNotInFuture");
    });

    it("reverts when client assigns the task to themselves", async function () {
      await expect(
        escrow.connect(client).createTask(BRIEF, AMOUNT, await deadlineIn(7), client.address)
      ).to.be.revertedWithCustomError(escrow, "CannotClaimOwnTask");
    });

    it("reverts when client has not approved the escrow", async function () {
      await usdc.connect(other).approve(await escrow.getAddress(), 0); // no-op, sanity
      await usdc.mint(other.address, AMOUNT);
      // other approved 0, so transferFrom must fail
      await expect(
        escrow.connect(other).createTask(BRIEF, AMOUNT, await deadlineIn(7), ZERO)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("reverts for unknown task id", async function () {
      await expect(escrow.getTask(99)).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });
  });

  describe("claimTask", function () {
    it("claims an open bounty, sets agent + Claimed, emits TaskClaimed", async function () {
      await createOpenBounty();
      await expect(escrow.connect(agent).claimTask(0))
        .to.emit(escrow, "TaskClaimed")
        .withArgs(0, agent.address);
      const task = await escrow.getTask(0);
      expect(task.agent).to.equal(agent.address);
      expect(task.status).to.equal(1);
    });

    it("client cannot claim their own task", async function () {
      await createOpenBounty();
      await expect(escrow.connect(client).claimTask(0)).to.be.revertedWithCustomError(
        escrow,
        "CannotClaimOwnTask"
      );
    });

    it("cannot claim an already-claimed task", async function () {
      await createOpenBounty();
      await escrow.connect(agent).claimTask(0);
      await expect(escrow.connect(other).claimTask(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("cannot claim a direct-hire task", async function () {
      await createDirectHire();
      await expect(escrow.connect(other).claimTask(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });
  });

  describe("submitDelivery + confirmDelivery (happy path)", function () {
    it("full flow: claim -> deliver -> confirm pays the agent", async function () {
      await createOpenBounty();
      await escrow.connect(agent).claimTask(0);
      await expect(escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://deliverable"))
        .to.emit(escrow, "DeliverySubmitted")
        .withArgs(0, agent.address, DELIVERY, "ipfs://deliverable");

      const before = await usdc.balanceOf(agent.address);
      await expect(escrow.connect(client).confirmDelivery(0))
        .to.emit(escrow, "DeliveryConfirmed")
        .withArgs(0, client.address, agent.address, AMOUNT);
      expect(await usdc.balanceOf(agent.address)).to.equal(before + AMOUNT);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0);
      expect((await escrow.getTask(0)).status).to.equal(3); // Completed
    });

    it("direct hire: agent delivers without claiming", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "https://example.com/work");
      expect((await escrow.getTask(0)).status).to.equal(2); // Delivered
    });

    it("only the assigned agent can submit", async function () {
      await createOpenBounty();
      await escrow.connect(agent).claimTask(0);
      await expect(
        escrow.connect(other).submitDelivery(0, DELIVERY, "ipfs://x")
      ).to.be.revertedWithCustomError(escrow, "NotAgent");
    });

    it("cannot submit on an unclaimed open bounty", async function () {
      await createOpenBounty();
      await expect(
        escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x")
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("cannot submit after the deadline", async function () {
      const { deadline } = await createDirectHire();
      await time.increaseTo(deadline + 1);
      await expect(
        escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x")
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("only the client can confirm", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await expect(escrow.connect(agent).confirmDelivery(0)).to.be.revertedWithCustomError(
        escrow,
        "NotClient"
      );
    });

    it("cannot confirm before delivery", async function () {
      await createDirectHire();
      await expect(escrow.connect(client).confirmDelivery(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("cannot confirm twice", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await escrow.connect(client).confirmDelivery(0);
      await expect(escrow.connect(client).confirmDelivery(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });
  });

  describe("cancelTask", function () {
    it("client cancels an open bounty and is refunded", async function () {
      await createOpenBounty();
      const before = await usdc.balanceOf(client.address);
      await expect(escrow.connect(client).cancelTask(0))
        .to.emit(escrow, "TaskCancelled")
        .withArgs(0, client.address, AMOUNT);
      expect(await usdc.balanceOf(client.address)).to.equal(before + AMOUNT);
      expect((await escrow.getTask(0)).status).to.equal(4); // Cancelled
    });

    it("cannot cancel a claimed task", async function () {
      await createDirectHire();
      await expect(escrow.connect(client).cancelTask(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("only the client can cancel", async function () {
      await createOpenBounty();
      await expect(escrow.connect(agent).cancelTask(0)).to.be.revertedWithCustomError(
        escrow,
        "NotClient"
      );
    });
  });

  describe("refundAfterTimeout", function () {
    it("client reclaims funds after deadline with no delivery", async function () {
      const { deadline } = await createDirectHire();
      await time.increaseTo(deadline + 1);
      const before = await usdc.balanceOf(client.address);
      await expect(escrow.connect(client).refundAfterTimeout(0))
        .to.emit(escrow, "TaskRefunded")
        .withArgs(0, client.address, AMOUNT);
      expect(await usdc.balanceOf(client.address)).to.equal(before + AMOUNT);
      expect((await escrow.getTask(0)).status).to.equal(5); // Refunded
    });

    it("reverts before the deadline", async function () {
      await createDirectHire();
      await expect(escrow.connect(client).refundAfterTimeout(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("reverts when a delivery exists (client must confirm or wait out review)", async function () {
      const { deadline } = await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(client).refundAfterTimeout(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("reverts on an open (unclaimed) task — use cancelTask instead", async function () {
      const { deadline } = await createOpenBounty();
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(client).refundAfterTimeout(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("only the client can refund", async function () {
      const { deadline } = await createDirectHire();
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(agent).refundAfterTimeout(0)).to.be.revertedWithCustomError(
        escrow,
        "NotClient"
      );
    });
  });

  describe("releaseAfterReview", function () {
    it("agent releases funds after 3-day review window with a silent client", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await time.increase(3 * DAY + 1);
      const before = await usdc.balanceOf(agent.address);
      await expect(escrow.connect(agent).releaseAfterReview(0))
        .to.emit(escrow, "FundsReleased")
        .withArgs(0, agent.address, AMOUNT);
      expect(await usdc.balanceOf(agent.address)).to.equal(before + AMOUNT);
      expect((await escrow.getTask(0)).status).to.equal(3); // Completed
    });

    it("reverts inside the review window", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await time.increase(3 * DAY - 60);
      await expect(escrow.connect(agent).releaseAfterReview(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });

    it("only the delivering agent can release", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await time.increase(3 * DAY + 1);
      await expect(escrow.connect(other).releaseAfterReview(0)).to.be.revertedWithCustomError(
        escrow,
        "NotAgent"
      );
    });

    it("client confirming first blocks the release (already completed)", async function () {
      await createDirectHire();
      await escrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");
      await escrow.connect(client).confirmDelivery(0);
      await time.increase(3 * DAY + 1);
      await expect(escrow.connect(agent).releaseAfterReview(0)).to.be.revertedWithCustomError(
        escrow,
        "InvalidStatus"
      );
    });
  });

  describe("registerProvider", function () {
    it("stores a provider name and emits ProviderRegistered", async function () {
      await expect(escrow.connect(agent).registerProvider("Rowan"))
        .to.emit(escrow, "ProviderRegistered")
        .withArgs(agent.address, "Rowan");
      expect(await escrow.providerName(agent.address)).to.equal("Rowan");
      expect(await escrow.providerName(other.address)).to.equal("");
    });

    it("reverts on an empty name", async function () {
      await expect(escrow.connect(agent).registerProvider("")).to.be.revertedWith(
        "name is empty"
      );
    });
  });

  describe("checkIn (free daily presence)", function () {
    async function today() {
      return Math.floor((await time.latest()) / DAY);
    }

    it("happy path: first check-in sets streak 1, total 1, emits CheckedIn", async function () {
      const day = await today();
      await expect(escrow.connect(agent).checkIn())
        .to.emit(escrow, "CheckedIn")
        .withArgs(agent.address, day, 1, 1);
      const [streak, total, lastDay] = await escrow.getPresence(agent.address);
      expect(streak).to.equal(1);
      expect(total).to.equal(1);
      expect(lastDay).to.equal(day);
    });

    it("second check-in on the same UTC day reverts", async function () {
      await escrow.connect(agent).checkIn();
      const day = await today();
      await expect(escrow.connect(agent).checkIn()).to.be.revertedWithCustomError(
        escrow,
        "AlreadyCheckedInToday"
      );
      // state untouched by the failed attempt
      const [streak, total, lastDay] = await escrow.getPresence(agent.address);
      expect(streak).to.equal(1);
      expect(total).to.equal(1);
      expect(lastDay).to.equal(day);
    });

    it("non-holder cannot check in", async function () {
      await expect(escrow.connect(stranger).checkIn()).to.be.revertedWithCustomError(
        escrow,
        "NotAgentIdHolder"
      );
    });

    it("streak increments on consecutive days", async function () {
      await escrow.connect(agent).checkIn(); // day N, streak 1
      const day0 = await today();
      // Advance to the start of the very next UTC day (consecutive).
      await time.increaseTo((day0 + 1) * DAY);
      const nextDay = await today();
      expect(nextDay).to.equal(day0 + 1);
      await expect(escrow.connect(agent).checkIn())
        .to.emit(escrow, "CheckedIn")
        .withArgs(agent.address, nextDay, 2, 2);
      const [streak, total, lastDay] = await escrow.getPresence(agent.address);
      expect(streak).to.equal(2);
      expect(total).to.equal(2);
      expect(lastDay).to.equal(nextDay);
    });

    it("streak resets to 1 after a missed day", async function () {
      await escrow.connect(agent).checkIn(); // streak 1
      const day0 = await today();
      await time.increaseTo((day0 + 3) * DAY); // skip two full days
      await escrow.connect(agent).checkIn();
      const [streak, total, lastDay] = await escrow.getPresence(agent.address);
      expect(streak).to.equal(1); // reset, not 2
      expect(total).to.equal(2);
      expect(lastDay).to.equal(day0 + 3);
    });

    it("streak survives a check-in late in the day, then next day", async function () {
      // time.increaseTo mines a block at the target timestamp, and the
      // following tx mines 1s later, so aim 2s before each day boundary.
      const day0 = await today();
      await time.increaseTo((day0 + 1) * DAY - 2);
      await escrow.connect(agent).checkIn(); // lands at end of day0
      await time.increaseTo((day0 + 2) * DAY - 2);
      await escrow.connect(agent).checkIn(); // lands at end of day0 + 1
      const [streak, total, lastDay] = await escrow.getPresence(agent.address);
      expect(streak).to.equal(2);
      expect(total).to.equal(2);
      expect(lastDay).to.equal(day0 + 1);
    });

    it("getPresence returns zeros for an address that never checked in", async function () {
      const [streak, total, lastDay] = await escrow.getPresence(other.address);
      expect(streak).to.equal(0);
      expect(total).to.equal(0);
      expect(lastDay).to.equal(0);
    });

    it("check-in moves no tokens and needs no USDC", async function () {
      const escrowBalBefore = await usdc.balanceOf(await escrow.getAddress());
      const agentBalBefore = await usdc.balanceOf(agent.address);
      await escrow.connect(agent).checkIn();
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(escrowBalBefore);
      expect(await usdc.balanceOf(agent.address)).to.equal(agentBalBefore);
    });

    it("different holders have independent streaks", async function () {
      await escrow.connect(agent).checkIn();
      await escrow.connect(other).checkIn();
      const [streakA] = await escrow.getPresence(agent.address);
      const [streakB] = await escrow.getPresence(other.address);
      expect(streakA).to.equal(1);
      expect(streakB).to.equal(1);
    });
  });

  describe("reentrancy", function () {
    it("a malicious token re-entering confirmDelivery cannot double-pay", async function () {
      const MaliciousToken = await ethers.getContractFactory("MaliciousToken");
      const evil = await MaliciousToken.deploy();
      const Escrow = await ethers.getContractFactory("AgentTaskEscrow");
      const evilEscrow = await Escrow.deploy(await evil.getAddress(), await agentId.getAddress());

      await evil.mint(client.address, AMOUNT * 10n);
      await evil.connect(client).approve(await evilEscrow.getAddress(), AMOUNT * 10n);
      const deadline = await deadlineIn(7);
      await evilEscrow.connect(client).createTask(BRIEF, AMOUNT, deadline, agent.address);
      await evilEscrow.connect(agent).submitDelivery(0, DELIVERY, "ipfs://x");

      // Arm the attack: the token's transfer() will re-enter confirmDelivery.
      await evil.arm(await evilEscrow.getAddress(), 0);

      const agentBefore = await evil.balanceOf(agent.address);
      // The re-entrant call is blocked by the ReentrancyGuard (the outer
      // call already holds the guard), which aborts the whole outer call:
      // no funds move, task stays Delivered.
      await expect(evilEscrow.connect(client).confirmDelivery(0)).to.be.revertedWithCustomError(
        evilEscrow,
        "ReentrancyGuardReentrantCall"
      );
      expect(await evil.balanceOf(agent.address)).to.equal(agentBefore);
      expect((await evilEscrow.getTask(0)).status).to.equal(2); // still Delivered

      // Attack spent (one-shot); a clean confirm now pays exactly once.
      // Note: the reverted attack tx rolled back its own disarm, so disarm
      // explicitly before the clean confirm.
      await evil.disarm();
      await evilEscrow.connect(client).confirmDelivery(0);
      expect(await evil.balanceOf(agent.address)).to.equal(agentBefore + AMOUNT);
      expect(await evil.balanceOf(await evilEscrow.getAddress())).to.equal(0);
    });
  });
});
