// STATE
// MV3 Service Worker State Management
const DEFAULT_STATE = {
    agentTabId: null,
    targetTabIds: [], // Array for storage compatibility
    messageQueue: [],
    isAgentBusy: false,
    busySince: 0,
    isGenesisComplete: false,
    pendingGenesisPrompt: null
};

// Helper to get state with defaults
async function getState() {
    const data = await chrome.storage.session.get(DEFAULT_STATE);
    // Ensure targetTabIds is an array (storage handles it, but just in case)
    if (!Array.isArray(data.targetTabIds)) data.targetTabIds = [];
    return { ...DEFAULT_STATE, ...data };
}

// Helper to update state
async function updateState(updates) {
    await chrome.storage.session.set(updates);
}

// Mutex for state synchronization
let stateMutex = Promise.resolve();

async function withLock(fn) {
    const next = stateMutex.then(async () => {
        try {
            await fn();
        } catch (e) {
            console.error("Error in withLock", e);
        }
    });
    stateMutex = next;
    return next;
}

const SYSTEM_INSTRUCTIONS = `
[SYSTEM HOST]: CONNECTED
[PROTOCOL]: STRICT JSON-RPC
[ROLE]: You are AgentAnything. You control a remote browser tab.

[COMMANDS]:
1. INTERACT: \`\`\`json { "tool": "interact", "id": "...", "action": "click"|"type", "value": "..." } \`\`\`
2. BROWSER:  \`\`\`json { "tool": "browser", "action": "refresh"|"back"|"find", "value": "..." } \`\`\`

[RULES]:
1. You will receive a TARGET MAP shortly.
2. Analyze the [INCOMING TRANSMISSION] queue.
3. Output JSON commands if action is required.
4. CRITICAL: You MUST end your response with the strictly distinct token: "[WAITING]"
5. The system will NOT send you new data until it sees "[WAITING]".

ACKNOWLEDGE with "[WAITING]" if you understand.
`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }); 
});

// --- QUEUE LOGIC ---
async function addToQueue(source, content, forceImmediate = false) {
    const state = await getState();
    const item = { source, content, timestamp: Date.now() };

    let newQueue = [...state.messageQueue];
    if (forceImmediate) newQueue.unshift(item);
    else newQueue.push(item);

    await updateState({ messageQueue: newQueue });
    await processQueue();
}

async function processQueue() {
    const state = await getState();

    // Check for deadlock timeout (3 minutes)
    if (state.isAgentBusy) {
        if (Date.now() - (state.busySince || 0) > 180000) {
            console.warn("[System] Agent deadlock detected. Forcing unlock.");
            await updateState({ isAgentBusy: false, busySince: 0 });
            // Continue processing
        } else {
            return;
        }
    }

    if (!state.agentTabId || state.messageQueue.length === 0) return;

    // Lock
    await updateState({ isAgentBusy: true, busySince: Date.now() });

    // Get item
    // We must fetch state again? No, we just locked it. But messageQueue might have changed?
    // In single threaded JS, if we didn't await between read and lock, we are fine.
    // But we did await updateState.
    // Let's rely on the state we read, but verify queue length.

    // Actually, let's just use the state we have, but we need to pop the item.
    let currentQueue = [...state.messageQueue];
    if (currentQueue.length === 0) {
        await updateState({ isAgentBusy: false, busySince: 0 });
        return;
    }

    const item = currentQueue.shift();
    await updateState({ messageQueue: currentQueue });
    
    let finalPayload = "";
    if (item.source === "SYSTEM_INIT") {
        finalPayload = item.content; // Raw injection
        console.log("[Queue] Dispatching GENESIS INSTRUCTIONS");
    } else {
        finalPayload = `
[INCOMING TRANSMISSION]
SOURCE: ${item.source}
TIMESTAMP: ${new Date(item.timestamp).toLocaleTimeString()}
--------------------------------------------------
${item.content}
--------------------------------------------------
[INSTRUCTION]: Process. End with "[WAITING]".
`;
        console.log(`[Queue] Dispatching ${item.source}`);
    }

    chrome.tabs.sendMessage(state.agentTabId, {
        action: "INJECT_PROMPT", 
        payload: finalPayload 
    }).catch(async (err) => {
        console.warn("Agent unreachable");
        await updateState({ isAgentBusy: false, busySince: 0 });
    });
}

// --- SEQUENCER & MEMORY ---
async function handleUserPrompt(userText) {
    let state = await getState();

    if (!state.isGenesisComplete) {
        console.log("[Sequencer] GENESIS TRIGGERED.");
        // We don't store pendingGenesisPrompt anymore, just use it immediately?
        // Logic used pendingGenesisPrompt to queue it later.

        await updateState({ pendingGenesisPrompt: userText });
        
        // 1. Queue Protocol
        await addToQueue("SYSTEM_INIT", SYSTEM_INSTRUCTIONS, true);
        
        // 2. Queue Memory (Universal + Domain)
        const memory = await chrome.storage.sync.get({ universalContext: '', domainContexts: {} });
        const store = await chrome.storage.session.get(['lastTargetPayload']);
        
        let contextBlock = "";
        
        // Universal
        if (memory.universalContext) {
            contextBlock += `[UNIVERSAL MEMORY]:\n${memory.universalContext}\n\n`;
        }
        
        // Domain Specific
        if (store.lastTargetPayload && store.lastTargetPayload.url) {
            const targetUrl = new URL(store.lastTargetPayload.url);
            const domain = targetUrl.hostname;
            
            // Simple string match for now
            for (const [key, val] of Object.entries(memory.domainContexts)) {
                if (domain.includes(key)) {
                    contextBlock += `[DOMAIN RULE (${key})]:\n${val}\n\n`;
                }
            }
        }
        
        if (contextBlock) {
            await addToQueue("CORTEX_MEMORY", contextBlock);
        }
        
        // 3. Queue Target Map
        const mapContent = store.lastTargetPayload ? store.lastTargetPayload.content : "NO TARGET CONNECTED YET";
        await addToQueue("TARGET", mapContent);
        
        // 4. Queue User Prompt
        // Refetch state to get pendingGenesisPrompt (although we just set it)
        state = await getState();
        await addToQueue("USER", state.pendingGenesisPrompt);
        
        await updateState({ isGenesisComplete: true });
    } else {
        await addToQueue("USER", userText);
    }
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  withLock(async () => {
    const senderTabId = sender.tab ? sender.tab.id : null;
    let state = await getState();

    if (msg.action === "HELLO" && senderTabId) {
        if (state.agentTabId === senderTabId) {
            chrome.tabs.sendMessage(senderTabId, { action: "INIT_AGENT" });
        } else if (state.targetTabIds.includes(senderTabId)) {
            chrome.tabs.sendMessage(senderTabId, { action: "INIT_TARGET" });
        }
        return;
    }

    if (msg.action === "ASSIGN_ROLE") {
      const targetId = msg.tabId;
      if (msg.role === "AGENT") {
        // Remove from targets if present
        let newTargets = state.targetTabIds.filter(id => id !== targetId);

        await updateState({
            agentTabId: targetId,
            targetTabIds: newTargets,
            messageQueue: [],
            isAgentBusy: false,
            isGenesisComplete: false,
            pendingGenesisPrompt: null
        });

        chrome.tabs.sendMessage(targetId, { action: "INIT_AGENT" });
      } else {
        // Add to targets, remove from agent if matching
        let newAgentId = state.agentTabId === targetId ? null : state.agentTabId;
        let newTargets = [...state.targetTabIds];
        if (!newTargets.includes(targetId)) newTargets.push(targetId);

        await updateState({
            agentTabId: newAgentId,
            targetTabIds: newTargets
        });

        chrome.tabs.sendMessage(targetId, { action: "INIT_TARGET" });
      }
    }

    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled [WAITING]. Unlock.");
        setTimeout(() => {
            withLock(async () => {
                await updateState({ isAgentBusy: false });
                await processQueue();
            });
        }, 2000); 
    }

    if (msg.action === "QUEUE_INPUT") {
        await handleUserPrompt(msg.payload);
    }

    if (msg.action === "TARGET_UPDATE") {
        await chrome.storage.session.set({ lastTargetPayload: msg.payload });
        // Check state again as handleUserPrompt might have changed it? No, just read it.
        state = await getState();
        if (state.isGenesisComplete) {
            await addToQueue("TARGET", msg.payload.content);
        }
    }

    if (msg.action === "AGENT_COMMAND") {
        const promises = state.targetTabIds.map(tId =>
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload })
                .then(() => ({ tId, status: 'success' }))
                .catch(() => ({ tId, status: 'failed' }))
        );
        const results = await Promise.all(promises);
        const failedIds = results.filter(r => r.status === 'failed').map(r => r.tId);

        if (failedIds.length > 0) {
            const freshState = await getState();
            const newTargets = freshState.targetTabIds.filter(id => !failedIds.includes(id));
            await updateState({ targetTabIds: newTargets });
        }
    }

    if (msg.action === "DISENGAGE_ALL") {
        if (state.agentTabId) chrome.tabs.sendMessage(state.agentTabId, { action: "DISENGAGE_LOCAL" }).catch(() => {});
        state.targetTabIds.forEach(tId => chrome.tabs.sendMessage(tId, { action: "DISENGAGE_LOCAL" }).catch(() => {}));

        await chrome.storage.session.clear();
    }

    // REMOTE_INJECT support for Popup
    if (msg.action === "REMOTE_INJECT") {
         await handleUserPrompt(msg.payload);
    }
  });
  return true;
});
