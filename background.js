// Service Worker V2.0 (Store-First Architecture)
console.log("[AgentAnything] Background Service Worker V2 Loaded");

// --- Configuration (Options) ---
let CONFIG = { redactPII: true, debugMode: false, privacyAccepted: false };

async function loadConfig() {
    const items = await chrome.storage.sync.get({ redactPII: true, debugMode: false, privacyAccepted: false });
    CONFIG = items;
    log("[System] Config Loaded:", CONFIG);
}

function log(msg, ...args) {
    if (CONFIG.debugMode) console.log(msg, ...args);
}

chrome.runtime.onStartup.addListener(loadConfig);
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

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
        log("[System] Config Updated:", CONFIG);
    }
});


// --- 1. State Persistence ---
const DEFAULT_STATE = {
    agentTabId: null,
    agentUrl: null, // Store Agent URL for recovery
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
    broadcastStatus(updates); // Auto-broadcast on state update
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

                // Update timestamp safe
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
        try { await chrome.debugger.detach(target); } catch(e) { console.error(e); }
    }
}

async function executeBackgroundType(tabId, x, y, value) {
    const target = { tabId };
    try {
        await chrome.debugger.attach(target, "1.3");
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x, y, button: "left", clickCount: 1
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x, y, button: "left", clickCount: 1
        });
        
        for (const char of value) {
             await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", text: char });
             await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp" });
        }
    } catch (e) {
        log(`Debugger type failed on ${tabId}: ${e.message}`);
    } finally {
        try { await chrome.debugger.detach(target); } catch(e) { console.error(e); }
    }
}


// --- 5. Message Routing ---

// sendMessageToTab was declared twice in the previous version. Removed the second declaration.
async function sendMessageToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) { return null; }
}

async function broadcastStatus(changes) {
    const state = await getState();
    let status = "Idle";
    let color = "red"; // Default to error/unknown
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
        status: status,
        color: color,
        queueLength: state.commandQueue.length,
        lastAction: state.lastActionTimestamp ? "Active" : "Waiting...",
        allowInput: allowInput
    };

    if (state.agentTabId) sendMessageToTab(state.agentTabId, { action: "DASHBOARD_UPDATE", payload });
    state.targetTabs.forEach(t => sendMessageToTab(t.tabId, { action: "DASHBOARD_UPDATE", payload }));
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
                // Refresh state inside lock
                state = await getState();
                const role = msg.role;
                const tid = msg.tabId;

                if (role === 'AGENT') {
                    // Prevent duplicate init
                    if (state.agentTabId === tid) return;

                    const targets = state.targetTabs.filter(t => t.tabId !== tid);

                    // Generate unique session keyword
                    const targetDomain = targets.length > 0 ? (new URL(targets[0].url).hostname) : "unknown";
                    const agentDomain = sender.tab?.url ? (new URL(sender.tab.url).hostname) : "unknown";
                    const sessionKeyword = `[END:${targetDomain}-${agentDomain}-${Date.now()}]`;

                    const taskDescription = msg.task ? `\n\nYOUR GOAL: ${msg.task}` : "";
                    const initialPrompt = `You are an autonomous agent. I will feed you the state of another tab. Output commands like \`interact\` to interact.${taskDescription}\n\nIMPORTANT: End EVERY response with this exact keyword: ${sessionKeyword}`;

                    await updateState({
                        agentTabId: tid,
                        agentUrl: sender.tab?.url || "", // Capture Agent URL
                        targetTabs: targets,
                        // commandQueue: [], // Preserve existing queue (e.g. Target Maps)
                        elementMap: {},
                        lastActionTimestamp: 0,
                        observationMode: true,
                        sessionKeyword: sessionKeyword
                    });

                    sendMessageToTab(tid, { action: "INIT_AGENT", keyword: sessionKeyword });

                    // Immediate execution of first prompt (Bypass Queue)
                    const safePayload = `<browsing_context>\n${initialPrompt}\n</browsing_context>`;
                    setTimeout(() => {
                        sendMessageToTab(tid, { action: "EXECUTE_PROMPT", text: safePayload });
                    }, 500); // Small delay to ensure INIT is processed

                } else {
                    // Check if already assigned
                    if (state.targetTabs.some(t => t.tabId === tid)) return;

                    let targets = [...state.targetTabs];
                    targets.push({ tabId: tid, url: sender.tab?.url || "" });

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
            await enqueue({ type: 'CLICK_TARGET', payload: msg.payload });
        }

        // Handle Intro Completion
        if (msg.action === "INTRO_COMPLETE") {
            log("[System] Intro Complete. Exiting Observation Mode.");
            await withLock(async () => {
                const s = await getState();
                if (s.observationMode) {
                    await updateState({ observationMode: false });
                    // If we have items in the queue (e.g., target map), they will be processed naturally
                    // by the next queue check or update trigger. Since we just finished intro,
                    // we might want to force a queue check if queue > 0.
                    if (s.commandQueue.length > 0) {
                        processQueue(s.commandQueue);
                    }
                }
            });
        }

        // Handle User Interruption
        if (msg.action === "USER_INTERRUPT") {
            log("[System] User Interruption Detected. Ignoring.");
            // await updateState({ commandQueue: [], lastActionTimestamp: 0 });
            // await enqueue({ type: 'UPDATE_AGENT', payload: "System: User manually interacted with the page. Queue cleared. Please re-assess state." });
        }

        if (msg.action === "DISENGAGE_ALL") {
            log("[System] Disengaging all tabs.");
            await withLock(async () => {
                const s = await getState();
                // Notify before clearing
                const payload = { status: "Idle", queueLength: 0, lastAction: "Disengaged" };
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

// Tab Recovery Logic
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await withLock(async () => {
        const state = await getState();

        // Recover Agent
        if (state.agentTabId === tabId && state.agentUrl) {
            log("[System] Agent tab closed. Recovering...");
            try {
                const newTab = await chrome.tabs.create({ url: state.agentUrl, active: false });
                await updateState({ agentTabId: newTab.id });
                // We rely on content script sending HELLO or user re-assigning,
                // but actually we should try to re-init if possible.
                // However, without content script ready, sendMessage fails.
                // Best we can do is update ID so if it reloads it might reconnect if we had persistent checks.
                // But simplified: Just open it. User might need to re-assign if content script doesn't auto-handshake.
            } catch (e) { console.error("Agent recovery failed:", e); }
        }

        // Recover Targets
        const targetIndex = state.targetTabs.findIndex(t => t.tabId === tabId);
        if (targetIndex !== -1) {
            const target = state.targetTabs[targetIndex];
            if (target.url) {
                log(`[System] Target tab ${tabId} closed. Recovering...`);
                try {
                    const newTab = await chrome.tabs.create({ url: target.url, active: false });
                    const newTargets = [...state.targetTabs];
                    newTargets[targetIndex] = { ...target, tabId: newTab.id };
                    await updateState({ targetTabs: newTargets });
                } catch (e) { console.error("Target recovery failed:", e); }
            }
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
