// Service Worker V2.0 (Store-First Architecture)
console.log("[AgentAnything] Background Service Worker V2 Loaded");

// --- 1. State Persistence (chrome.storage.local) ---
// V2 Requirement: "All queue states and active tab IDs must be saved to chrome.storage.local."
const DEFAULT_STATE = {
    agentTabId: null,
    targetTabs: [], // [{tabId, url, status}]
    commandQueue: [], // [{type: 'UPDATE_AGENT'|'CLICK_TARGET', payload: ...}]
    isAgentBusy: false,
    busySince: 0
};

async function getState() {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    // Ensure arrays
    if (!Array.isArray(data.targetTabs)) data.targetTabs = [];
    if (!Array.isArray(data.commandQueue)) data.commandQueue = [];
    return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
    await chrome.storage.local.set(updates);
}

// --- 2. Keep-Alive (Offscreen) ---
let keepAliveInterval;
async function createOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSING'],
      justification: 'Keep service worker alive'
    });
  } catch (e) { console.warn("Offscreen failed:", e); }
}

function startKeepAlive() {
  createOffscreen();
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' });
  }, 20000);
}
chrome.runtime.onStartup.addListener(startKeepAlive);
startKeepAlive();

// --- 3. Command Processing (Event Driven) ---

// V2: "chrome.storage.onChanged.addListener... processQueue"
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.commandQueue) {
        const newQueue = changes.commandQueue.newValue;
        if (newQueue && newQueue.length > 0) {
            processQueue(newQueue);
        }
    }
});

// Mutex for processing
let isProcessing = false;

async function processQueue(queue) {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // V2: "The Service Worker processes the queue one item at a time."
        const item = queue[0];
        if (!item) { isProcessing = false; return; }

        console.log(`[Queue] Processing: ${item.type}`);

        const state = await getState();
        const agentId = state.agentTabId;
        
        // TYPE: UPDATE_AGENT (Target -> Agent)
        if (item.type === 'UPDATE_AGENT') {
            if (agentId) {
                // Send to Agent Bridge (BUFFER_UPDATE)
                await sendMessageToTab(agentId, {
                    action: "BUFFER_UPDATE",
                    text: item.payload
                });
            }
        }

        // TYPE: CLICK_TARGET (Agent -> Target)
        if (item.type === 'CLICK_TARGET') {
             const cmd = item.payload; // { tool: 'interact', id: 45, action: 'click' }

             // Try to find element in targets
             for (const t of state.targetTabs) {
                 const res = await sendMessageToTab(t.tabId, { action: "GET_COORDINATES", id: cmd.id });
                 if (res && res.found) {
                     if (cmd.action === 'click') {
                         await executeBackgroundClick(t.tabId, res.x, res.y);
                     } else if (cmd.action === 'type') {
                         await executeBackgroundType(t.tabId, res.x, res.y, cmd.value);
                     }
                     break;
                 }
             }
        }

        // Dequeue
        const remaining = queue.slice(1);
        await updateState({ commandQueue: remaining });

    } catch (e) {
        console.error("Queue Processing Error:", e);
    } finally {
        isProcessing = false;
    }
}


// --- 4. Execution Engine (Debugger) ---

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
        console.warn(`Debugger click failed on ${tabId}: ${e.message}`);
    } finally {
        try {
            await chrome.debugger.detach(target);
        } catch(e) {
            console.error(`Error detaching debugger from ${tabId}:`, e);
        }
    }
}

async function executeBackgroundType(tabId, x, y, value) {
    const target = { tabId };
    try {
        await chrome.debugger.attach(target, "1.3");
        // Focus click
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed", x, y, button: "left", clickCount: 1
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased", x, y, button: "left", clickCount: 1
        });

        // Type
        for (const char of value) {
             await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", text: char });
             await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp" });
        }
    } catch (e) {
        console.warn(`Debugger type failed on ${tabId}: ${e.message}`);
    } finally {
        try {
            await chrome.debugger.detach(target);
        } catch(e) {
             console.error(`Error detaching debugger from ${tabId}:`, e);
        }
    }
}


// --- 5. Message Routing (Bridge -> SW -> Queue) ---

async function sendMessageToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
        return null; // Tab closed or reloading
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        const state = await getState();
        const tabId = sender.tab ? sender.tab.id : null;

        // HELLO / INIT
        if (msg.action === "HELLO" && tabId) {
            if (state.agentTabId === tabId) {
                sendMessageToTab(tabId, { action: "INIT_AGENT" }); // Trigger Bridge
            } else if (state.targetTabs.some(t => t.tabId === tabId)) {
                sendMessageToTab(tabId, { action: "INIT_TARGET" }); // Trigger Adapter
            }
        }

        // ASSIGN_ROLE (from Popup)
        if (msg.action === "ASSIGN_ROLE") {
            const role = msg.role;
            const tid = msg.tabId;

            if (role === 'AGENT') {
                const targets = state.targetTabs.filter(t => t.tabId !== tid);
                await updateState({
                    agentTabId: tid,
                    targetTabs: targets,
                    commandQueue: [] // Clear old queue
                });
                sendMessageToTab(tid, { action: "INIT_AGENT" });

                // Inject Initial Prompt
                const initialPrompt = "You are an autonomous agent. I will feed you the state of another tab. Output commands like `interact` to interact.";
                await enqueue({ type: 'UPDATE_AGENT', payload: initialPrompt });

            } else {
                let targets = [...state.targetTabs];
                if (!targets.some(t => t.tabId === tid)) {
                    targets.push({ tabId: tid, url: sender.tab?.url || "" });
                }
                const agent = state.agentTabId === tid ? null : state.agentTabId;
                await updateState({ targetTabs: targets, agentTabId: agent });
                sendMessageToTab(tid, { action: "INIT_TARGET" });
            }
        }

        // TARGET_UPDATE (Target -> SW -> Queue -> Agent)
        if (msg.action === "TARGET_UPDATE") {
            // Buffer into Queue
            await enqueue({ type: 'UPDATE_AGENT', payload: msg.payload });
        }

        // AGENT_COMMAND (Agent -> SW -> Queue -> Target)
        if (msg.action === "AGENT_COMMAND") {
            await enqueue({ type: 'CLICK_TARGET', payload: msg.payload });
        }

    })();
    return true;
});

async function enqueue(item) {
    const state = await getState();
    const q = [...state.commandQueue, item];
    await updateState({ commandQueue: q });
}
