// Service Worker V2.1 (Tools + Tab Limit)
console.log("[AgentAnything] Background Service Worker V2.1 Loaded");

// --- Configuration (Options) ---
// maxTabs: how many target tabs the AI may control simultaneously (user-configurable)
let CONFIG = { redactPII: true, debugMode: false, privacyAccepted: false, maxTabs: 3 };

async function loadConfig() {
    const items = await chrome.storage.sync.get({
        redactPII: true,
        debugMode: false,
        privacyAccepted: false,
        maxTabs: 3
    });
    CONFIG = items;
    log("[System] Config Loaded:", CONFIG);
}

// --- Saved Tools ---
async function getSavedTools() {
    const data = await chrome.storage.sync.get({ savedTools: [] });
    return Array.isArray(data.savedTools) ? data.savedTools : [];
}

function log(msg, ...args) {
    if (CONFIG.debugMode) console.log(msg, ...args);
}

// FIX: setAccessLevel must run on EVERY service worker start, not just onInstalled.
// Session storage is cleared on browser restart, so this needs to be re-applied.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

chrome.runtime.onStartup.addListener(loadConfig);
chrome.runtime.onInstalled.addListener(() => {
    // Onboarding
    chrome.storage.sync.get(['privacyAccepted'], (res) => {
        if (!res.privacyAccepted) {
            chrome.tabs.create({ url: 'welcome.html' });
        }
    });
    loadConfig();
});

loadConfig();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        if (changes.redactPII) CONFIG.redactPII = changes.redactPII.newValue;
        if (changes.debugMode) CONFIG.debugMode = changes.debugMode.newValue;
        if (changes.privacyAccepted) CONFIG.privacyAccepted = changes.privacyAccepted.newValue;
        if (changes.maxTabs) CONFIG.maxTabs = changes.maxTabs.newValue;
        log("[System] Config Updated:", CONFIG);
    }
});


// --- 1. State Persistence ---
const DEFAULT_STATE = {
    agentTabId: null,
    agentUrl: null,
    targetTabs: [],
    commandQueue: [],
    isAgentBusy: false,
    busySince: 0,
    elementMap: {},
    lastActionTimestamp: 0,
    observationMode: false,
    sessionKeyword: null
};

// State Mutex
let stateLock = Promise.resolve();
async function withLock(fn) {
    const currentLock = stateLock;
    stateLock = (async () => {
        try { await currentLock; } catch (e) { console.error("Lock recovery:", e); }
        try { await fn(); } catch (e) { console.error("Lock task failed:", e); }
    })();
    return stateLock;
}

async function getState() {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    if (!Array.isArray(data.targetTabs)) data.targetTabs = [];
    if (!Array.isArray(data.commandQueue)) data.commandQueue = [];
    if (!data.elementMap) data.elementMap = {};
    return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
    await chrome.storage.local.set(updates);
    broadcastStatus();
}

// --- 2. Keep-Alive ---
let keepAliveInterval;
async function createOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSING'],
      justification: 'Keep service worker alive'
    });
  } catch (e) { log("Offscreen warning:", e); }
}

function startKeepAlive() {
  createOffscreen();
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' }).catch(() => {});
    }
    checkTimeout();
  }, 20000);
}
chrome.runtime.onStartup.addListener(startKeepAlive);
startKeepAlive();

// --- 3. Command Processing ---

// Tracks tabs opened programmatically by the AI that haven't loaded yet.
// When chrome.tabs.onUpdated fires 'complete' for these, we auto-init them as targets.
const pendingTargetAssignments = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    if (!pendingTargetAssignments.has(tabId)) return;
    pendingTargetAssignments.delete(tabId);

    // Give document_idle content scripts a moment after 'complete'
    setTimeout(async () => {
        const state = await getState();
        if (state.targetTabs.some(t => t.tabId === tabId)) {
            await sendMessageToTab(tabId, { action: "INIT_TARGET", config: CONFIG });
            log(`[System] Auto-initialized pending target tab ${tabId}`);
        }
    }, 600);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.commandQueue) {
        const newQueue = changes.commandQueue.newValue;
        if (newQueue && newQueue.length > 0) {
            processQueue(newQueue);
        }
    }
});

let isProcessing = false;

async function processQueue(queue) {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const item = queue[0];
        if (!item) { isProcessing = false; return; }

        // Enforce Privacy Acceptance
        if (!CONFIG.privacyAccepted) {
            console.warn("[System] Privacy Warning not accepted. Blocking command.");
            await withLock(async () => {
                const s = await getState();
                if (s.commandQueue.length > 0) await updateState({ commandQueue: s.commandQueue.slice(1) });
            });
            chrome.tabs.create({ url: 'welcome.html' });
            return;
        }

        log(`[Queue] Processing: ${item.type}`);

        let state = await getState();
        const agentId = state.agentTabId;

        if (item.type === 'UPDATE_AGENT') {
            if (agentId) {
                const safePayload = `<browsing_context>\n${item.payload}\n</browsing_context>`;
                await sendMessageToTab(agentId, {
                    action: "BUFFER_UPDATE",
                    text: safePayload
                });
                await withLock(async () => { await updateState({ lastActionTimestamp: 0 }); });
            }
        }

        if (item.type === 'CLICK_TARGET') {
             const cmd = item.payload;
             let targetId = cmd.targetId;

             if (!targetId && cmd.id && state.elementMap[cmd.id]) {
                 targetId = state.elementMap[cmd.id];
             }

             let targetsToTry = state.targetTabs;
             if (targetId) {
                 const t = state.targetTabs.find(tab => tab.tabId === targetId);
                 if (t) targetsToTry = [t];
             }

             let executed = false;
             for (const t of targetsToTry) {
                 const res = await sendMessageToTab(t.tabId, { action: "GET_COORDINATES", id: cmd.id });
                 if (res && res.found) {
                     log(`[System] Executing on Target Tab ${t.tabId}`);
                     if (cmd.action === 'click') {
                         await executeBackgroundClick(t.tabId, res.x, res.y);
                     } else if (cmd.action === 'type') {
                         await executeBackgroundType(t.tabId, res.x, res.y, cmd.value);
                     }
                     executed = true;
                     await withLock(async () => { await updateState({ lastActionTimestamp: Date.now() }); });
                     break;
                 }
             }

             if (!executed) {
                 log(`[System] Failed to execute command. Element ID ${cmd.id} not found.`);
                 await enqueue({ type: 'UPDATE_AGENT', payload: `System Error: Element ID ${cmd.id} not found.` });
             }
        }

        // Open a URL in a new background tab and assign it as a target.
        // Enforces CONFIG.maxTabs by releasing the oldest target assignment if at limit.
        if (item.type === 'OPEN_TAB') {
            const { url } = item.payload;
            let freshState = await getState();
            const maxTabs = CONFIG.maxTabs || 3;
            let updatedTargets = [...freshState.targetTabs];

            if (updatedTargets.length >= maxTabs) {
                // Release oldest assignment (FIFO). We don't close the actual browser tab —
                // the user may want it. We just stop controlling it.
                const released = updatedTargets.shift();
                log(`[System] Tab limit (${maxTabs}) reached. Releasing tab ${released.tabId} (${released.url}).`);
                sendMessageToTab(released.tabId, {
                    action: "DASHBOARD_UPDATE",
                    payload: { status: "Idle", color: "red", queueLength: 0, lastAction: "Released by agent", isAgentTab: false }
                });
            }

            try {
                const newTab = await chrome.tabs.create({ url, active: false });
                updatedTargets.push({ tabId: newTab.id, url });
                pendingTargetAssignments.set(newTab.id, true);
                await updateState({ targetTabs: updatedTargets });
                log(`[System] Opened new target tab ${newTab.id}: ${url}`);
            } catch(e) {
                console.error("[System] Failed to open tab:", e);
                await enqueue({ type: 'UPDATE_AGENT', payload: `System Error: Failed to open URL "${url}". ${e.message}` });
            }
        }

        // Resolve a named tool to its URL, then re-enqueue as OPEN_TAB.
        if (item.type === 'OPEN_TOOL') {
            const { name } = item.payload;
            const tools = await getSavedTools();
            const tool = tools.find(t => t.name.toLowerCase() === name.toLowerCase());

            if (tool) {
                log(`[System] Resolving tool "${name}" → ${tool.url}`);
                await enqueue({ type: 'OPEN_TAB', payload: { url: tool.url } });
            } else {
                const available = tools.length > 0
                    ? tools.map(t => `"${t.name}"`).join(', ')
                    : 'none saved yet';
                await enqueue({
                    type: 'UPDATE_AGENT',
                    payload: `System Error: Tool "${name}" not found. Available tools: ${available}`
                });
            }
        }

        // Safe Removal
        await withLock(async () => {
            const s = await getState();
            if (s.commandQueue.length > 0) {
                 await updateState({ commandQueue: s.commandQueue.slice(1) });
            }
        });

    } catch (e) {
        console.error("Queue Processing Error:", e);
    } finally {
        isProcessing = false;
    }
}

// Timeout Logic (15s)
async function checkTimeout() {
    const state = await getState();
    if (state.lastActionTimestamp > 0 && (Date.now() - state.lastActionTimestamp > 15000)) {
        log("[System] Action Timeout. No DOM change detected.");
        await updateState({ lastActionTimestamp: 0 });
        await enqueue({ type: 'UPDATE_AGENT', payload: "System: Action executed but no DOM change detected within 15 seconds." });
    }
}

// --- 4. Execution Engine ---

async function executeBackgroundClick(tabId, x, y) {
    const target = { tabId };
    try {
        await chrome.debugger.attach(target, "1.3");
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x, y, button: "left", clickCount: 1
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x, y, button: "left", clickCount: 1
        });
    } catch (e) {
        log(`Debugger click failed on ${tabId}: ${e.message}`);
    } finally {
        try { await chrome.debugger.detach(target); } catch(e) { /* already detached */ }
    }
}

async function executeBackgroundType(tabId, x, y, value) {
    const target = { tabId };
    try {
        await chrome.debugger.attach(target, "1.3");
        // Click to focus element
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x, y, button: "left", clickCount: 1
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x, y, button: "left", clickCount: 1
        });
        // Type each character
        for (const char of value) {
            // keyDown + char event is the correct CDP pattern for text input
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
                type: "keyDown",
                key: char,
                text: char,
                unmodifiedText: char
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
                type: "char",
                key: char,
                text: char,
                unmodifiedText: char
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
                type: "keyUp",
                key: char
            });
        }
    } catch (e) {
        log(`Debugger type failed on ${tabId}: ${e.message}`);
    } finally {
        try { await chrome.debugger.detach(target); } catch(e) { /* already detached */ }
    }
}


// --- 5. Message Routing ---

async function sendMessageToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) { return null; }
}

async function broadcastStatus() {
    const state = await getState();
    let status = "Idle";
    let color = "red";
    let allowInput = false;

    if (state.observationMode) {
        status = "Waiting for Intro... (Manual Override Active)";
        color = "yellow";
        allowInput = true;
    } else if (state.agentTabId && state.targetTabs.length > 0) {
        if (state.commandQueue.length > 0) {
            status = "Working";
            color = "green";
        } else {
            status = "Linked (Waiting)";
            color = "yellow";
        }
    } else if (state.agentTabId) {
        status = "Waiting for Target";
        color = "yellow";
    } else if (state.targetTabs.length > 0) {
        status = "Waiting for Agent";
        color = "yellow";
    }

    const payload = {
        status,
        color,
        isAgentTab: false, // will be overridden per-tab below
        queueLength: state.commandQueue.length,
        lastAction: state.lastActionTimestamp ? "Active" : "Waiting...",
        allowInput
    };

    // FIX: Tag agent vs target so dashboard can choose whether to block
    if (state.agentTabId) {
        sendMessageToTab(state.agentTabId, {
            action: "DASHBOARD_UPDATE",
            payload: { ...payload, isAgentTab: true }
        });
    }
    state.targetTabs.forEach(t => {
        sendMessageToTab(t.tabId, {
            action: "DASHBOARD_UPDATE",
            payload: { ...payload, isAgentTab: false }
        });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        let state = await getState();
        const tabId = sender.tab ? sender.tab.id : null;

        if (msg.action === "HELLO" && tabId) {
            if (state.agentTabId === tabId) {
                sendMessageToTab(tabId, { action: "INIT_AGENT" });
            } else if (state.targetTabs.some(t => t.tabId === tabId)) {
                sendMessageToTab(tabId, { action: "INIT_TARGET", config: CONFIG });
            }
        }

        if (msg.action === "ASSIGN_ROLE") {
            await withLock(async () => {
                state = await getState();
                const role = msg.role;
                const tid = msg.tabId;

                // FIX: sender.tab is null when called from popup (not a content script).
                // Use chrome.tabs.get to fetch actual tab URL.
                let tabUrl = "";
                try {
                    const tabInfo = await chrome.tabs.get(tid);
                    tabUrl = tabInfo.url || "";
                } catch(e) {
                    console.error("[System] Could not get tab info:", e);
                    return;
                }

                if (role === 'AGENT') {
                    if (state.agentTabId === tid) return;

                    const targets = state.targetTabs.filter(t => t.tabId !== tid);

                    const safeGetHostname = (u) => {
                        try { return new URL(u).hostname; } catch (e) { return "unknown"; }
                    };
                    const targetDomain = targets.length > 0 ? safeGetHostname(targets[0].url) : "unknown";
                    const agentDomain = safeGetHostname(tabUrl);
                    const sessionKeyword = `[END:${targetDomain}-${agentDomain}-${Date.now()}]`;

                    await updateState({
                        agentTabId: tid,
                        agentUrl: tabUrl,
                        targetTabs: targets,
                        elementMap: {},
                        lastActionTimestamp: 0,
                        observationMode: true,
                        sessionKeyword: sessionKeyword
                    });

                    sendMessageToTab(tid, { action: "INIT_AGENT", keyword: sessionKeyword });

                    const initialPrompt = await buildInitialPrompt(msg.task, sessionKeyword);
                    const safePayload = `<browsing_context>\n${initialPrompt}\n</browsing_context>`;
                    setTimeout(() => {
                        sendMessageToTab(tid, { action: "EXECUTE_PROMPT", text: safePayload });
                    }, 500);

                } else {
                    if (state.targetTabs.some(t => t.tabId === tid)) return;

                    let targets = [...state.targetTabs];
                    targets.push({ tabId: tid, url: tabUrl }); // FIX: was sender.tab?.url

                    const agent = state.agentTabId === tid ? null : state.agentTabId;
                    await updateState({ targetTabs: targets, agentTabId: agent });
                    sendMessageToTab(tid, { action: "INIT_TARGET", config: CONFIG });
                }
            });
        }

        if (msg.action === "TARGET_UPDATE") {
            if (msg.elementIds && Array.isArray(msg.elementIds)) {
                const newMap = { ...state.elementMap };
                msg.elementIds.forEach(id => newMap[id] = tabId);
                await updateState({ elementMap: newMap });
            }
            await enqueue({ type: 'UPDATE_AGENT', payload: msg.payload });
        }

        if (msg.action === "AGENT_COMMAND") {
            const cmd = msg.payload;
            // Route based on the action field in the command JSON
            if (cmd.action === 'open_tab' && cmd.url) {
                await enqueue({ type: 'OPEN_TAB', payload: { url: cmd.url } });
            } else if (cmd.action === 'open_tool' && cmd.name) {
                await enqueue({ type: 'OPEN_TOOL', payload: { name: cmd.name } });
            } else {
                // click / type → target interaction
                await enqueue({ type: 'CLICK_TARGET', payload: cmd });
            }
        }

        // Saves a site as a named, reusable tool the AI can invoke by name.
        if (msg.action === "SAVE_TOOL") {
            const { name, url } = msg;
            if (!name || !url) return;
            const existing = await getSavedTools();
            // Replace if same name already saved (case-insensitive)
            const filtered = existing.filter(t => t.name.toLowerCase() !== name.toLowerCase());
            const tool = { id: Date.now().toString(), name, url };
            await chrome.storage.sync.set({ savedTools: [...filtered, tool] });
            log(`[System] Saved tool: "${name}" → ${url}`);
        }

        if (msg.action === "DELETE_TOOL") {
            const { id } = msg;
            if (!id) return;
            const existing = await getSavedTools();
            await chrome.storage.sync.set({ savedTools: existing.filter(t => t.id !== id) });
            log(`[System] Deleted tool id: ${id}`);
        }

        // FIX: Added missing REMOTE_INJECT handler. This powers the "Send Command" button in the popup.
        if (msg.action === "REMOTE_INJECT") {
            state = await getState();
            if (state.agentTabId && msg.payload) {
                log("[System] Remote inject:", msg.payload);
                await sendMessageToTab(state.agentTabId, {
                    action: "EXECUTE_PROMPT",
                    text: msg.payload
                });
            }
        }

        if (msg.action === "INTRO_COMPLETE") {
            log("[System] Intro Complete. Exiting Observation Mode.");
            await withLock(async () => {
                const s = await getState();
                if (s.observationMode) {
                    await updateState({ observationMode: false });
                    if (s.commandQueue.length > 0) {
                        processQueue(s.commandQueue);
                    }
                }
            });
        }

        if (msg.action === "USER_INTERRUPT") {
            log("[System] User Interruption Detected.");
            // Currently a no-op; uncomment to clear queue on user interaction:
            // await updateState({ commandQueue: [], lastActionTimestamp: 0 });
        }

        if (msg.action === "DISENGAGE_ALL") {
            log("[System] Disengaging all tabs.");
            await withLock(async () => {
                const s = await getState();
                const payload = { status: "Idle", queueLength: 0, lastAction: "Disengaged", isAgentTab: false };
                if (s.agentTabId) sendMessageToTab(s.agentTabId, { action: "DASHBOARD_UPDATE", payload });
                s.targetTabs.forEach(t => sendMessageToTab(t.tabId, { action: "DASHBOARD_UPDATE", payload }));

                await updateState({
                    agentTabId: null,
                    targetTabs: [],
                    commandQueue: [],
                    elementMap: {},
                    lastActionTimestamp: 0,
                    observationMode: false,
                    sessionKeyword: null
                });
            });
        }

    })();
    return true;
});

// Tab cleanup (without aggressive auto-recovery)
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await withLock(async () => {
        const state = await getState();

        if (state.agentTabId === tabId) {
            log("[System] Agent tab closed. Clearing agent assignment.");
            await updateState({ agentTabId: null, agentUrl: null, observationMode: false });
        }

        const targetIndex = state.targetTabs.findIndex(t => t.tabId === tabId);
        if (targetIndex !== -1) {
            const newTargets = state.targetTabs.filter(t => t.tabId !== tabId);
            log(`[System] Target tab ${tabId} removed.`);
            await updateState({ targetTabs: newTargets });
        }
    });
});

async function enqueue(item) {
    await withLock(async () => {
        const state = await getState();
        const q = [...state.commandQueue, item];
        await updateState({ commandQueue: q });
    });
}

// Builds the system prompt injected into the agent AI at session start.
// Includes the full command reference, available saved tools, and tab constraints.
async function buildInitialPrompt(task, sessionKeyword) {
    const tools = await getSavedTools();
    const maxTabs = CONFIG.maxTabs || 3;

    const toolsSection = tools.length > 0
        ? `═══ AVAILABLE TOOLS ═══\n${tools.map(t => `  • ${t.name.padEnd(20)} → ${t.url}`).join('\n')}\n\n`
        : '';

    const taskSection = task
        ? `═══ YOUR GOAL ═══\n${task}\n\n`
        : '';

    return `You are an autonomous web agent. An extension feeds you live browser state and executes your commands.

═══ COMMAND REFERENCE ═══
Output ONE command at a time as JSON inside <tool_code> tags:

  Click an element:       <tool_code>{"action": "click", "id": <number>}</tool_code>
  Type into a field:      <tool_code>{"action": "type", "id": <number>, "value": "<text>"}</tool_code>
  Open a URL (new tab):   <tool_code>{"action": "open_tab", "url": "<full URL>"}</tool_code>
  Open a saved Tool:      <tool_code>{"action": "open_tool", "name": "<exact tool name>"}</tool_code>

${toolsSection}═══ CONSTRAINTS ═══
• You may control up to ${maxTabs} tab${maxTabs !== 1 ? 's' : ''} simultaneously.
• When you open a new tab at the limit, the oldest tab is automatically released.
• After every action you will receive updated DOM snapshots of all active target tabs.
• Interactive elements in each snapshot are numbered — use those numbers as "id" values.
• Wait for a DOM update before issuing the next command; do not chain multiple commands at once.

${taskSection}IMPORTANT: End EVERY response with this exact keyword: ${sessionKeyword}`;
}
