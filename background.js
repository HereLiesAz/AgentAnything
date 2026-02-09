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
    targetTabs: [],
    commandQueue: [],
    isAgentBusy: false,
    busySince: 0,
    elementMap: {},
    lastActionTimestamp: 0
};

async function getState() {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    if (!Array.isArray(data.targetTabs)) data.targetTabs = [];
    if (!Array.isArray(data.commandQueue)) data.commandQueue = [];
    if (!data.elementMap) data.elementMap = {};
    return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
    await chrome.storage.local.set(updates);
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
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
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
            // Open welcome page again if needed? Or just ignore?
            // Dequeue to prevent loop? Or notify user?
            // Notify user via alert?
            // Let's remove from queue and open welcome page.

            await updateState({ commandQueue: queue.slice(1) }); // Remove
            chrome.tabs.create({ url: 'welcome.html' });

            isProcessing = false;
            return;
        }

        log(`[Queue] Processing: ${item.type}`);

        const state = await getState();
        const agentId = state.agentTabId;

        if (item.type === 'UPDATE_AGENT') {
            if (agentId) {
                const safePayload = `<browsing_context>\n${item.payload}\n</browsing_context>`;
                await sendMessageToTab(agentId, {
                    action: "BUFFER_UPDATE",
                    text: safePayload
                });

                await updateState({ lastActionTimestamp: 0 });
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
                     await updateState({ lastActionTimestamp: Date.now() });
                     break;
                 }
             }

             if (!executed) {
                 log(`[System] Failed to execute command. Element ID ${cmd.id} not found.`);
                 await enqueue({ type: 'UPDATE_AGENT', payload: `System Error: Element ID ${cmd.id} not found.` });
             }
        }

        const remaining = queue.slice(1);
        await updateState({ commandQueue: remaining });

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

// --- 5. Message Routing ---

async function sendMessageToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) { return null; }
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

async function sendMessageToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) { return null; }
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
            const role = msg.role;
            const tid = msg.tabId;

            if (role === 'AGENT') {
                const targets = state.targetTabs.filter(t => t.tabId !== tid);
                await updateState({
                    agentTabId: tid,
                    targetTabs: targets,
                    commandQueue: [],
                    elementMap: {},
                    lastActionTimestamp: 0
                });
                sendMessageToTab(tid, { action: "INIT_AGENT" });

                const initialPrompt = "You are an autonomous agent. I will feed you the state of another tab. Output commands like `interact` to interact.";
                await enqueue({ type: 'UPDATE_AGENT', payload: initialPrompt });

            } else {
                let targets = [...state.targetTabs];
                if (!targets.some(t => t.tabId === tid)) {
                    targets.push({ tabId: tid, url: sender.tab?.url || "" });
                }
                const agent = state.agentTabId === tid ? null : state.agentTabId;
                await updateState({ targetTabs: targets, agentTabId: agent });
                sendMessageToTab(tid, { action: "INIT_TARGET", config: CONFIG });
            }
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

        // Handle User Interruption
        if (msg.action === "USER_INTERRUPT") {
            log("[System] User Interruption Detected. Clearing Queue.");
            await updateState({ commandQueue: [], lastActionTimestamp: 0 });
            await enqueue({ type: 'UPDATE_AGENT', payload: "System: User manually interacted with the page. Queue cleared. Please re-assess state." });
        }

    })();
    return true;
});

async function enqueue(item) {
    const state = await getState();
    const q = [...state.commandQueue, item];
    await updateState({ commandQueue: q });
}
