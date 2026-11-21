/* Hire Rowan — dApp logic (vanilla JS + ethers v6).
 *
 * Wallet connection is ONLY via the injected provider (window.ethereum —
 * Binance Wallet extension / in-app browser / MetaMask). No QR login, no
 * WalletConnect, no server-side sessions. Every transaction is sent from the
 * user's own wallet and confirmed in their wallet prompt.
 */
"use strict";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TASK_STATUSES = ["Open", "Claimed", "Delivered", "Completed", "Cancelled", "Refunded"];

// ---------- State ----------
const state = {
  provider: null,        // ethers BrowserProvider (wallet) or JsonRpcProvider (read-only)
  signer: null,
  account: null,
  chainId: null,
  escrow: null,          // read or signer-connected escrow contract
  token: null,
  agentId: null,
  tokenDecimals: CONFIG.USDC_DECIMALS_FALLBACK,
  tokenSymbol: "USDC",
  hasAgentId: false,
  myProviderName: "",
  tasks: [],
  presence: null,        // { currentStreak, totalCheckIns, lastCheckInDay } (BigInts) or null
  expectedNetwork: CONFIG.TESTNET_MODE ? CONFIG.TESTNET : CONFIG.MAINNET,
  escrowAddress: CONFIG.TESTNET_MODE ? CONFIG.TESTNET_CONTRACT_ADDRESS : CONFIG.CONTRACT_ADDRESS,
  tokenAddress: CONFIG.TESTNET_MODE ? CONFIG.TESTNET_USDC_ADDRESS : CONFIG.USDC_ADDRESS,
  agentIdAddress: CONFIG.TESTNET_MODE ? CONFIG.TESTNET_AGENT_ID_CONTRACT : CONFIG.AGENT_ID_CONTRACT,
};

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const els = {
  connectBtn: $("connectBtn"),
  disconnectBtn: $("disconnectBtn"),
  walletInfo: $("walletInfo"),
  walletAddress: $("walletAddress"),
  walletNetwork: $("walletNetwork"),
  agentIdStatus: $("agentIdStatus"),
  escrowAddress: $("escrowAddress"),
  expectedNetwork: $("expectedNetwork"),
  currentNetwork: $("currentNetwork"),
  paymentToken: $("paymentToken"),
  agentIdRegistry: $("agentIdRegistry"),
  switchNetworkBtn: $("switchNetworkBtn"),
  networkNote: $("networkNote"),
  deployNote: $("deployNote"),
  statusBox: $("statusBox"),
  createForm: $("createForm"),
  briefText: $("briefText"),
  amountInput: $("amountInput"),
  deadlineInput: $("deadlineInput"),
  assigneeInput: $("assigneeInput"),
  briefHashBox: $("briefHashBox"),
  briefHashValue: $("briefHashValue"),
  approveBtn: $("approveBtn"),
  createBtn: $("createBtn"),
  allowanceNote: $("allowanceNote"),
  providerNameInput: $("providerNameInput"),
  registerBtn: $("registerBtn"),
  providerStatus: $("providerStatus"),
  taskBoard: $("taskBoard"),
  refreshBtn: $("refreshBtn"),
  checkInCard: $("checkInCard"),
  checkInBtn: $("checkInBtn"),
  checkInNote: $("checkInNote"),
  streakValue: $("streakValue"),
  totalCheckInsValue: $("totalCheckInsValue"),
  lastCheckInValue: $("lastCheckInValue"),
};

function showStatus(message, kind = "info") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status-box ${kind}`;
  els.statusBox.classList.remove("hidden");
}
function hideStatus() {
  els.statusBox.classList.add("hidden");
}
function shortAddr(addr) {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}
function fmtAmount(raw) {
  try { return ethers.formatUnits(raw, state.tokenDecimals); } catch { return String(raw); }
}
function fmtTime(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString();
}
function isZeroAddress(addr) {
  return !addr || addr.toLowerCase() === ZERO_ADDRESS;
}
function isDeployed(addr) {
  return addr && addr.toLowerCase() !== ZERO_ADDRESS;
}

// SHA-256 of UTF-8 text, returned as a 0x-prefixed 32-byte hex string (bytes32).
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function friendlyError(err) {
  const msg = (err && (err.shortMessage || err.message)) || String(err);
  if (err && (err.code === 4001 || err.code === "ACTION_REJECTED")) {
    return "Transaction rejected in your wallet. Nothing was sent.";
  }
  if (/user denied/i.test(msg) || /user rejected/i.test(msg)) {
    return "Transaction rejected in your wallet. Nothing was sent.";
  }
  if (/insufficient funds/i.test(msg)) return "Insufficient funds for gas or for the escrowed amount.";
  if (/execution reverted/i.test(msg)) return "The contract rejected this transaction: " + msg;
  return msg;
}

// Run a write transaction: send, wait for confirmation, refresh the board.
async function sendTx(promiseFn, pendingMsg, successMsg) {
  showStatus(pendingMsg, "pending");
  try {
    const tx = await promiseFn();
    showStatus(`${pendingMsg} Transaction sent (${tx.hash}). Waiting for confirmation…`, "pending");
    const receipt = await tx.wait();
    if (receipt && receipt.status === 0) {
      showStatus("Transaction failed on-chain. No state change was applied.", "error");
      return null;
    }
    showStatus(successMsg, "success");
    await loadTasks();
    await refreshAllowanceNote();
    return receipt;
  } catch (err) {
    showStatus("Error: " + friendlyError(err), "error");
    return null;
  }
}

// ---------- Read-only setup (works before wallet connection) ----------
function setupReadOnly() {
  const net = state.expectedNetwork;
  els.expectedNetwork.textContent = `${net.name} (chain ${net.chainId})`;
  els.escrowAddress.textContent = isDeployed(state.escrowAddress)
    ? state.escrowAddress
    : "Not deployed yet — set CONTRACT_ADDRESS in config.js after deployment.";
  els.paymentToken.textContent = isDeployed(state.tokenAddress) ? state.tokenAddress : "Not deployed yet";
  els.agentIdRegistry.textContent = state.agentIdAddress;
  els.deployNote.textContent = isDeployed(state.escrowAddress)
    ? ""
    : "The escrow contract is not deployed yet, so task actions are unavailable. The board below will load once a contract address is configured.";

  const rpc = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId);
  state.provider = rpc;
  if (isDeployed(state.escrowAddress)) {
    state.escrow = new ethers.Contract(state.escrowAddress, ESCROW_ABI, rpc);
  }
  if (isDeployed(state.tokenAddress)) {
    state.token = new ethers.Contract(state.tokenAddress, ERC20_ABI, rpc);
    state.token.decimals().then((d) => { state.tokenDecimals = Number(d); }).catch(() => {});
    state.token.symbol().then((s) => { state.tokenSymbol = s; }).catch(() => {});
  }
  if (isDeployed(state.agentIdAddress)) {
    state.agentId = new ethers.Contract(state.agentIdAddress, ERC721_ABI, rpc);
  }
}

// ---------- Wallet connection ----------
async function connectWallet() {
  if (!window.ethereum) {
    showStatus(
      "No injected wallet found. Install the Binance Wallet extension, open this page in the Binance Wallet in-app browser, or use MetaMask, then try again.",
      "error"
    );
    return;
  }
  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await browserProvider.send("eth_requestAccounts", []);
    if (!accounts || accounts.length === 0) {
      showStatus("No account was shared by your wallet.", "error");
      return;
    }
    state.provider = browserProvider;
    state.signer = await browserProvider.getSigner();
    state.account = accounts[0];
    const network = await browserProvider.getNetwork();
    state.chainId = Number(network.chainId);

    if (isDeployed(state.escrowAddress)) {
      state.escrow = new ethers.Contract(state.escrowAddress, ESCROW_ABI, state.signer);
    }
    if (isDeployed(state.tokenAddress)) {
      state.token = new ethers.Contract(state.tokenAddress, ERC20_ABI, state.signer);
      try { state.tokenDecimals = Number(await state.token.decimals()); } catch { /* keep fallback */ }
      try { state.tokenSymbol = await state.token.symbol(); } catch { /* keep USDC */ }
    }
    if (isDeployed(state.agentIdAddress)) {
      state.agentId = new ethers.Contract(state.agentIdAddress, ERC721_ABI, state.signer);
    }

    renderWalletUI();
    await checkAgentId();
    await refreshPresence();
    await refreshProviderName();
    await loadTasks();
    await refreshAllowanceNote();
    updateFormState();
    hideStatus();

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
  } catch (err) {
    showStatus("Could not connect wallet: " + friendlyError(err), "error");
  }
}

function handleAccountsChanged(accounts) {
  if (!accounts || accounts.length === 0) { disconnectLocal(); return; }
  connectWallet();
}
function handleChainChanged() {
  // Simplest correct behaviour: re-initialise against the new chain.
  window.location.reload();
}

function disconnectLocal() {
  // Injected providers have no server session to kill; we just clear local state.
  state.signer = null;
  state.account = null;
  state.hasAgentId = false;
  state.myProviderName = "";
  state.presence = null;
  setupReadOnly();
  renderWalletUI();
  refreshPresence();
  updateFormState();
  loadTasks();
}

function renderWalletUI() {
  const connected = !!state.account;
  els.connectBtn.classList.toggle("hidden", connected);
  els.walletInfo.classList.toggle("hidden", !connected);
  els.checkInCard.classList.toggle("hidden", !connected);
  if (!connected) {
    els.currentNetwork.textContent = "Not connected";
    els.switchNetworkBtn.classList.add("hidden");
    els.networkNote.textContent = "";
    return;
  }
  els.walletAddress.textContent = shortAddr(state.account);
  els.walletAddress.title = state.account;
  const onExpected = state.chainId === state.expectedNetwork.chainId;
  els.walletNetwork.textContent = onExpected
    ? `${state.expectedNetwork.name} ✓`
    : `Chain ${state.chainId} — wrong network`;
  els.walletNetwork.className = `pill ${onExpected ? "ok" : "bad"}`;
  els.currentNetwork.textContent = onExpected
    ? `${state.expectedNetwork.name} (chain ${state.chainId})`
    : `Chain ${state.chainId} — expected ${state.expectedNetwork.name} (chain ${state.expectedNetwork.chainId})`;
  els.switchNetworkBtn.classList.toggle("hidden", onExpected);
  els.networkNote.textContent = onExpected ? "" : "You are on the wrong network for this deployment.";
}

async function checkAgentId() {
  if (!state.agentId || !state.account) {
    els.agentIdStatus.textContent = "Agent ID: unknown";
    els.agentIdStatus.className = "pill warn";
    state.hasAgentId = false;
    return;
  }
  try {
    const bal = await state.agentId.balanceOf(state.account);
    state.hasAgentId = bal > 0n;
    if (state.hasAgentId) {
      els.agentIdStatus.textContent = "Agent ID holder ✅";
      els.agentIdStatus.className = "pill ok";
    } else {
      els.agentIdStatus.textContent = "No Agent ID";
      els.agentIdStatus.className = "pill warn";
      els.agentIdStatus.title = "Claim one in the Binance App (Wallet > banner > Agent ID).";
    }
  } catch (err) {
    els.agentIdStatus.textContent = "Agent ID: check failed";
    els.agentIdStatus.className = "pill warn";
    state.hasAgentId = false;
    console.error("Agent ID check failed:", err);
  }
}

// ---------- Daily check-in (free front door) ----------
// UTC day number, matching the contract's `block.timestamp / 1 days`.
function todayUtcDay() {
  return Math.floor(Date.now() / 86400000);
}

// A lastCheckInDay of 0 means "never checked in".
function fmtCheckInDay(day) {
  const n = Number(day);
  if (!n) return "Never";
  return new Date(n * 86400000).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function updateCheckInButton() {
  const connected = !!state.signer && !!state.account;
  const deployed = isDeployed(state.escrowAddress);
  const onExpected = state.chainId === state.expectedNetwork.chainId;
  let reason = "";
  if (!connected || !state.hasAgentId) {
    reason = "Connect a wallet holding an Agent ID to check in";
  } else if (!deployed) {
    reason = "Escrow contract not deployed yet.";
  } else if (!onExpected) {
    reason = "Switch to the expected network first.";
  } else if (state.presence && Number(state.presence.lastCheckInDay) === todayUtcDay()) {
    reason = "Already checked in today — come back tomorrow";
  }
  els.checkInBtn.disabled = reason !== "";
  els.checkInBtn.title = reason || "Check in for today (gas only, no USDC).";
  els.checkInNote.textContent = reason;
}

async function refreshPresence() {
  if (!state.escrow || !state.account) {
    state.presence = null;
    els.streakValue.textContent = "—";
    els.totalCheckInsValue.textContent = "—";
    els.lastCheckInValue.textContent = "—";
    updateCheckInButton();
    return;
  }
  try {
    const p = await state.escrow.getPresence(state.account);
    state.presence = {
      currentStreak: p[0],
      totalCheckIns: p[1],
      lastCheckInDay: p[2],
    };
    const streak = state.presence.currentStreak;
    els.streakValue.textContent = `🔥 ${streak} day${streak === 1n ? "" : "s"}`;
    els.totalCheckInsValue.textContent = String(state.presence.totalCheckIns);
    els.lastCheckInValue.textContent = fmtCheckInDay(state.presence.lastCheckInDay);
  } catch (err) {
    console.error("getPresence failed:", err);
    state.presence = null;
    els.streakValue.textContent = "—";
    els.totalCheckInsValue.textContent = "—";
    els.lastCheckInValue.textContent = "—";
  }
  updateCheckInButton();
}

async function doCheckIn() {
  if (!state.signer || !state.escrow) { showStatus("Connect your wallet first.", "error"); return; }
  if (!state.hasAgentId) {
    showStatus("Checking in requires an Agent ID. Claim one in the Binance App (Wallet > banner > Agent ID).", "error");
    return;
  }
  if (state.presence && Number(state.presence.lastCheckInDay) === todayUtcDay()) {
    showStatus("Already checked in today — come back tomorrow.", "info");
    return;
  }
  const receipt = await sendTx(
    () => state.escrow.checkIn(),
    "Checking in — please confirm in your wallet…",
    "Checked in for today."
  );
  if (receipt) {
    await refreshPresence();
    const streak = state.presence ? state.presence.currentStreak : null;
    showStatus(
      streak !== null
        ? `Checked in for today. 🔥 Your streak is now ${streak} day${streak === 1n ? "" : "s"}.`
        : "Checked in for today.",
      "success"
    );
  }
}

async function switchNetwork() {
  if (!window.ethereum) return;
  const net = state.expectedNetwork;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainIdHex }],
    });
  } catch (err) {
    if (err && err.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: net.chainIdHex,
            chainName: net.name,
            rpcUrls: [net.rpcUrl],
            blockExplorerUrls: [net.explorer],
            nativeCurrency: net.nativeCurrency,
          }],
        });
      } catch (addErr) {
        showStatus("Could not add the network: " + friendlyError(addErr), "error");
      }
    } else {
      showStatus("Could not switch network: " + friendlyError(err), "error");
    }
  }
}

// ---------- Provider registration ----------
async function refreshProviderName() {
  if (!state.escrow || !state.account) return;
  try {
    const name = await state.escrow.providerName(state.account);
    state.myProviderName = name || "";
    els.providerStatus.textContent = name
      ? `You are registered as “${name}”.`
      : "You are not registered as a provider yet.";
  } catch {
    els.providerStatus.textContent = "";
  }
}

async function registerProvider() {
  const name = els.providerNameInput.value.trim();
  if (!name) { showStatus("Enter a display name first.", "error"); return; }
  if (!state.signer || !state.escrow) { showStatus("Connect your wallet first.", "error"); return; }
  if (!state.hasAgentId) {
    showStatus("Registering requires an Agent ID. Claim one in the Binance App (Wallet > banner > Agent ID).", "error");
    return;
  }
  await sendTx(
    () => state.escrow.registerProvider(name),
    "Registering provider — please confirm in your wallet…",
    `Registered as provider “${name}”.`
  );
  await refreshProviderName();
}

// ---------- Create task: approve + create ----------
function parseAmountInput() {
  const raw = els.amountInput.value.trim();
  if (!raw || Number(raw) <= 0) return null;
  try { return ethers.parseUnits(raw, state.tokenDecimals); } catch { return null; }
}

async function refreshAllowanceNote() {
  if (!state.token || !state.account || !isDeployed(state.escrowAddress)) {
    els.allowanceNote.textContent = "";
    return;
  }
  try {
    const [allowance, balance] = await Promise.all([
      state.token.allowance(state.account, state.escrowAddress),
      state.token.balanceOf(state.account),
    ]);
    els.allowanceNote.textContent =
      `Your ${state.tokenSymbol} balance: ${fmtAmount(balance)}. ` +
      `Current allowance for the escrow contract: ${fmtAmount(allowance)}. ` +
      `Approval is for the exact task amount only — never unlimited.`;
  } catch {
    els.allowanceNote.textContent = "";
  }
}

async function approveUsdc() {
  const amount = parseAmountInput();
  if (amount === null) { showStatus("Enter a valid USDC amount greater than 0 first.", "error"); return; }
  if (!state.signer || !state.token) { showStatus("Connect your wallet first.", "error"); return; }
  if (!state.hasAgentId) {
    showStatus("Creating a task requires an Agent ID. Claim one in the Binance App (Wallet > banner > Agent ID).", "error");
    return;
  }
  // Exact-amount approval only (never unlimited).
  await sendTx(
    () => state.token.approve(state.escrowAddress, amount),
    `Approving exactly ${fmtAmount(amount)} ${state.tokenSymbol} for the escrow contract — please confirm in your wallet…`,
    `Approved ${fmtAmount(amount)} ${state.tokenSymbol}. You can now create the task.`
  );
  updateFormState();
}

async function updateBriefHashPreview() {
  const text = els.briefText.value.trim();
  if (text.length >= 10) {
    els.briefHashValue.textContent = await sha256Hex(text);
    els.briefHashBox.classList.remove("hidden");
  } else {
    els.briefHashBox.classList.add("hidden");
  }
  updateFormState();
}

async function createTask(event) {
  event.preventDefault();
  const brief = els.briefText.value.trim();
  const amount = parseAmountInput();
  const deadlineStr = els.deadlineInput.value;
  const assigneeRaw = els.assigneeInput.value.trim();

  if (brief.length < 10) { showStatus("Describe the task in at least 10 characters.", "error"); return; }
  if (amount === null) { showStatus("Enter a valid USDC amount greater than 0.", "error"); return; }
  if (!deadlineStr) { showStatus("Pick a deadline.", "error"); return; }
  const deadline = Math.floor(new Date(deadlineStr).getTime() / 1000);
  if (!Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
    showStatus("The deadline must be in the future.", "error");
    return;
  }
  let assignee = ZERO_ADDRESS;
  if (assigneeRaw) {
    if (!ethers.isAddress(assigneeRaw)) { showStatus("The assignee address is not a valid address.", "error"); return; }
    assignee = assigneeRaw;
  }
  if (!state.signer || !state.escrow) { showStatus("Connect your wallet first.", "error"); return; }
  if (!state.hasAgentId) {
    showStatus("Creating a task requires an Agent ID. Claim one in the Binance App (Wallet > banner > Agent ID).", "error");
    return;
  }
  try {
    const allowance = await state.token.allowance(state.account, state.escrowAddress);
    if (allowance < amount) {
      showStatus("Insufficient allowance. Approve the USDC amount first (step 1).", "error");
      return;
    }
  } catch (err) {
    showStatus("Could not check your USDC allowance: " + friendlyError(err), "error");
    return;
  }

  const briefHash = await sha256Hex(brief);
  await sendTx(
    () => state.escrow.createTask(briefHash, amount, deadline, assignee),
    "Creating task — please confirm in your wallet…",
    `Task created. Brief hash ${briefHash} is stored on-chain; the USDC is now held in escrow.`
  );
  els.createForm.reset();
  els.briefHashBox.classList.add("hidden");
  updateFormState();
}

function updateFormState() {
  const connected = !!state.signer;
  const deployed = isDeployed(state.escrowAddress);
  const onExpected = state.chainId === state.expectedNetwork.chainId;
  const amountOk = parseAmountInput() !== null;

  const approveDisabled = !connected || !deployed || !onExpected || !amountOk || !state.hasAgentId;
  els.approveBtn.disabled = approveDisabled;
  els.approveBtn.title = !connected ? "Connect your wallet first."
    : !deployed ? "Escrow contract not deployed yet."
    : !onExpected ? "Switch to the expected network first."
    : !state.hasAgentId ? "You need an Agent ID to create a task."
    : !amountOk ? "Enter a valid USDC amount first."
    : "Approve exactly this amount of USDC for the escrow contract.";

  const createDisabled = !connected || !deployed || !onExpected || !state.hasAgentId;
  els.createBtn.disabled = createDisabled;
  els.createBtn.title = !connected ? "Connect your wallet first."
    : !deployed ? "Escrow contract not deployed yet."
    : !onExpected ? "Switch to the expected network first."
    : !state.hasAgentId ? "You need an Agent ID to create a task."
    : "Create the task (requires USDC approval first).";

  els.registerBtn.disabled = !connected || !deployed || !onExpected || !state.hasAgentId;
  els.registerBtn.title = !connected ? "Connect your wallet first."
    : !deployed ? "Escrow contract not deployed yet."
    : !onExpected ? "Switch to the expected network first."
    : !state.hasAgentId ? "You need an Agent ID to register."
    : "Register as a provider.";

  updateCheckInButton();
}

// ---------- Task board ----------
function taskToObject(t) {
  // getTask returns a tuple; access by index (robust across ethers versions).
  return {
    id: Number(t[0]),
    client: t[1],
    agent: t[2],
    assignee: t[3],
    amount: t[4],
    briefHash: t[5],
    deadline: Number(t[6]),
    deliveredAt: Number(t[7]),
    deliveryHash: t[8],
    deliveryURI: t[9],
    status: Number(t[10]),
  };
}

async function loadTasks() {
  if (!state.escrow) {
    els.taskBoard.innerHTML = `<p class="muted">The escrow contract is not deployed yet. Set the contract address in <code>config.js</code> after deployment and the board will load here.</p>`;
    return;
  }
  els.taskBoard.innerHTML = `<p class="muted">Loading tasks…</p>`;
  try {
    const count = Number(await state.escrow.taskCount());
    state.tasks = [];
    const start = Math.max(0, count - CONFIG.MAX_TASKS_SHOWN);
    for (let id = count - 1; id >= start; id--) {
      try {
        state.tasks.push(taskToObject(await state.escrow.getTask(id)));
      } catch (err) {
        console.error(`getTask(${id}) failed:`, err);
      }
    }
    renderTasks();
  } catch (err) {
    els.taskBoard.innerHTML = `<p class="muted">Could not load tasks: ${friendlyError(err)}</p>`;
  }
}

function actionButton(label, enabled, reason, onClick, danger = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn " + (danger ? "btn-danger" : "btn-secondary");
  btn.textContent = label;
  btn.disabled = !enabled;
  btn.title = enabled ? label : reason;
  if (enabled) btn.addEventListener("click", onClick);
  return btn;
}

function renderTasks() {
  const board = els.taskBoard;
  board.innerHTML = "";
  if (state.tasks.length === 0) {
    board.innerHTML = `<p class="muted">No tasks yet. Create the first one above.</p>`;
    return;
  }
  const me = state.account ? state.account.toLowerCase() : null;
  const now = Math.floor(Date.now() / 1000);

  for (const task of state.tasks) {
    const statusName = TASK_STATUSES[task.status] || `Unknown (${task.status})`;
    const isClient = me && task.client.toLowerCase() === me;
    const isAgent = me && task.agent.toLowerCase() === me;
    const isAssignee = me && task.assignee.toLowerCase() === me;
    const isDirectHire = !isZeroAddress(task.assignee);
    const effectiveAgent = isDirectHire ? task.assignee : task.agent;
    const canDeliver = (isAgent || (isDirectHire && isAssignee))
      && (task.status === 1 || (task.status === 0 && isDirectHire))
      && task.deadline > now;
    const reviewEndsAt = task.deliveredAt + CONFIG.REVIEW_WINDOW_SECONDS;
    const canRelease = isAgent && task.status === 2 && now >= reviewEndsAt;
    const canRefund = isClient && task.status !== 3 && task.status !== 4 && task.status !== 5
      && task.status !== 2 && task.deadline <= now;

    const card = document.createElement("article");
    card.className = "task-card";

    const head = document.createElement("div");
    head.className = "task-head";
    const idEl = document.createElement("span");
    idEl.className = "task-id";
    idEl.textContent = `Task #${task.id}`;
    const statusEl = document.createElement("span");
    statusEl.className = `status-pill status-${statusName}`;
    statusEl.textContent = statusName;
    head.append(idEl, statusEl);
    card.appendChild(head);

    const kv = document.createElement("dl");
    kv.className = "kv";
    const rows = [
      ["Client", shortAddr(task.client)],
      ["Assignee", isDirectHire ? shortAddr(task.assignee) : "Open bounty — anyone with an Agent ID can claim"],
      ["Agent", isZeroAddress(task.agent) ? "—" : shortAddr(task.agent)],
      ["Amount", `${fmtAmount(task.amount)} ${state.tokenSymbol}`],
      ["Deadline", fmtTime(task.deadline) + (task.deadline <= now && task.status < 3 ? " (passed)" : "")],
      ["Brief hash", task.briefHash],
    ];
    if (task.status >= 2 && task.deliveredAt) {
      rows.push(["Delivered at", fmtTime(task.deliveredAt)]);
      rows.push(["Delivery hash", task.deliveryHash]);
      rows.push(["Delivery", task.deliveryURI || "—"]);
      if (task.status === 2) {
        rows.push(["Review window ends", fmtTime(reviewEndsAt)]);
      }
    }
    for (const [label, value] of rows) {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (label === "Delivery" && task.deliveryURI) {
        dd.textContent = "";
        const a = document.createElement("a");
        a.href = task.deliveryURI;
        a.textContent = task.deliveryURI;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        dd.appendChild(a);
      }
      if (label === "Brief hash" || label === "Delivery hash") dd.className = "mono";
      div.append(dt, dd);
      kv.appendChild(div);
    }
    card.appendChild(kv);

    // Delivery form (only for the agent who can deliver).
    if (canDeliver) {
      const form = document.createElement("div");
      form.className = "delivery-form";
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.placeholder = "Delivery URL (e.g. IPFS / public link)";
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.placeholder = "Deliverable text to hash (e.g. summary or file content)";
      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "btn btn-primary";
      submitBtn.textContent = "Submit Delivery";
      submitBtn.addEventListener("click", async () => {
        const uri = urlInput.value.trim();
        const text = textInput.value.trim();
        if (!uri) { showStatus("Enter a delivery URL.", "error"); return; }
        if (!text) { showStatus("Enter the deliverable text to hash.", "error"); return; }
        const deliveryHash = await sha256Hex(text);
        await sendTx(
          () => state.escrow.submitDelivery(task.id, deliveryHash, uri),
          "Submitting delivery — please confirm in your wallet…",
          `Delivery submitted for task #${task.id} (hash ${deliveryHash}).`
        );
      });
      form.append(urlInput, textInput, submitBtn);
      card.appendChild(form);
    }

    const actions = document.createElement("div");
    actions.className = "task-actions";
    const connected = !!me;
    const deployed = isDeployed(state.escrowAddress);
    const onExpected = state.chainId === state.expectedNetwork.chainId || !connected;

    actions.appendChild(actionButton(
      "Claim",
      connected && deployed && onExpected && state.hasAgentId && !isClient && task.status === 0 && isZeroAddress(task.assignee),
      !connected ? "Connect your wallet first."
        : !deployed ? "Escrow contract not deployed yet."
        : !onExpected ? "Switch to the expected network first."
        : !state.hasAgentId ? "You need an Agent ID to claim."
        : isClient ? "You cannot claim your own task."
        : task.status !== 0 ? "Only open tasks can be claimed."
        : "Only open bounties (no fixed assignee) can be claimed.",
      () => sendTx(
        () => state.escrow.claimTask(task.id),
        `Claiming task #${task.id} — please confirm in your wallet…`,
        `Task #${task.id} claimed. You are now the assigned agent.`
      )
    ));

    actions.appendChild(actionButton(
      "Confirm Delivery",
      connected && deployed && onExpected && isClient && task.status === 2,
      !connected ? "Connect your wallet first."
        : !isClient ? "Only the client can confirm delivery."
        : task.status !== 2 ? "Nothing to confirm yet — the task is not in Delivered status."
        : "Switch to the expected network first.",
      () => sendTx(
        () => state.escrow.confirmDelivery(task.id),
        `Confirming delivery for task #${task.id} — please confirm in your wallet…`,
        `Delivery confirmed. ${fmtAmount(task.amount)} ${state.tokenSymbol} released to ${shortAddr(effectiveAgent)}.`
      )
    ));

    actions.appendChild(actionButton(
      "Cancel",
      connected && deployed && onExpected && isClient && task.status === 0,
      !connected ? "Connect your wallet first."
        : !isClient ? "Only the client can cancel."
        : task.status !== 0 ? "Only open, unclaimed tasks can be cancelled."
        : "Switch to the expected network first.",
      () => sendTx(
        () => state.escrow.cancelTask(task.id),
        `Cancelling task #${task.id} — please confirm in your wallet…`,
        `Task #${task.id} cancelled. The escrowed ${state.tokenSymbol} is refunded to you.`
      ),
      true
    ));

    actions.appendChild(actionButton(
      "Refund after timeout",
      connected && deployed && onExpected && canRefund,
      !connected ? "Connect your wallet first."
        : !isClient ? "Only the client can request a refund."
        : task.status === 2 ? "A delivery exists — confirm it, or wait out the 3-day review window."
        : task.deadline > now ? "The deadline has not passed yet."
        : "This task can no longer be refunded.",
      () => sendTx(
        () => state.escrow.refundAfterTimeout(task.id),
        `Requesting a refund for task #${task.id} — please confirm in your wallet…`,
        `Task #${task.id} refunded. The escrowed ${state.tokenSymbol} is back with you.`
      ),
      true
    ));

    actions.appendChild(actionButton(
      "Release after review",
      connected && deployed && onExpected && canRelease,
      !connected ? "Connect your wallet first."
        : !isAgent ? "Only the assigned agent can release after review."
        : task.status !== 2 ? "The task is not in Delivered status."
        : now < reviewEndsAt ? `The 3-day review window ends ${fmtTime(reviewEndsAt)}.`
        : "Switch to the expected network first.",
      () => sendTx(
        () => state.escrow.releaseAfterReview(task.id),
        `Releasing funds for task #${task.id} — please confirm in your wallet…`,
        `Funds released for task #${task.id}. ${fmtAmount(task.amount)} ${state.tokenSymbol} sent to you.`
      )
    ));

    card.appendChild(actions);

    if (connected && task.status === 0 && !isClient && isZeroAddress(task.assignee) && !state.hasAgentId) {
      const note = document.createElement("p");
      note.className = "action-reason";
      note.textContent = "You need an Agent ID to claim this bounty. Claim one in the Binance App (Wallet > banner > Agent ID).";
      card.appendChild(note);
    }
    board.appendChild(card);
  }
}

// ---------- Wire up ----------
els.connectBtn.addEventListener("click", connectWallet);
els.disconnectBtn.addEventListener("click", disconnectLocal);
els.switchNetworkBtn.addEventListener("click", switchNetwork);
els.checkInBtn.addEventListener("click", doCheckIn);
els.refreshBtn.addEventListener("click", loadTasks);
els.registerBtn.addEventListener("click", registerProvider);
els.approveBtn.addEventListener("click", approveUsdc);
els.createForm.addEventListener("submit", createTask);
els.briefText.addEventListener("input", updateBriefHashPreview);
els.amountInput.addEventListener("input", updateFormState);
els.assigneeInput.addEventListener("input", updateFormState);

// Default deadline: 7 days from now (minimum the date picker accepts).
(function setDefaultDeadline() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  els.deadlineInput.value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

// Boot: read-only board first, then wallet if the user connects.
if (typeof ethers === "undefined") {
  showStatus("Failed to load the ethers.js library from the CDN. Check your connection and reload the page.", "error");
} else {
  setupReadOnly();
  updateFormState();
  loadTasks();
}
