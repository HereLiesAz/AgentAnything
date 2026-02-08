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

    // Atomic: Lock AND Dequeue
    let currentQueue = [...state.messageQueue];
    const item = currentQueue.shift();

    await updateState({
        isAgentBusy: true,
        busySince: Date.now(),
        messageQueue: currentQueue
    });
    
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
async function queueGenesisInstructions() {
    // 1. Queue Protocol
    await addToQueue("SYSTEM_INIT", SYSTEM_INSTRUCTIONS);

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
}

async function handleUserPrompt(userText) {
    // Just queue the user prompt directly. Genesis should be pre-queued by ASSIGN_ROLE.
    await addToQueue("USER", userText);
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

        // Queue Genesis Instructions IMMEDIATELY
        await queueGenesisInstructions();

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

      // Check if both roles are assigned to trigger GENESIS MODE
      const freshState = await getState();
      if (freshState.agentTabId && freshState.targetTabIds.length > 0) {
          console.log("[System] Both roles assigned. Triggering GENESIS MODE.");
          chrome.tabs.sendMessage(freshState.agentTabId, { action: "GENESIS_MODE_ACTIVE" });
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
        // Always queue the target update if we have an agent
        state = await getState();
        if (state.agentTabId) {
            await addToQueue("TARGET", msg.payload.content);
        }
    }

    if (msg.action === "AGENT_COMMAND") {
        // Collect all send promises
        const sendPromises = state.targetTabIds.map(tId =>
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload })
                .then(() => ({ id: tId, success: true }))
                .catch(() => ({ id: tId, success: false }))
        );

        const results = await Promise.all(sendPromises);
        const failedIds = results.filter(r => !r.success).map(r => r.id);

        if (failedIds.length > 0) {
            // Re-fetch state inside lock to ensure we don't clobber recent add/removes
            // But we are already inside withLock, so `state` variable is valid for this transaction?
            // Actually, we awaited Promise.all, so other events could have queued on the mutex?
            // No, `withLock` chains promises. The next msg handler won't run until this function finishes.
            // So `state` is safe? Yes, because we haven't yielded the mutex.
            // Wait, `await Promise.all` yields execution. Does `withLock` block new executions?
            // `withLock` chains onto `stateMutex`. The next `withLock` call appends a .then() to the chain.
            // That .then() callback won't run until the previous one resolves.
            // So yes, we are exclusive.

            // Just in case, let's use the current state logic:
            const newTargets = state.targetTabIds.filter(id => !failedIds.includes(id));
            if (newTargets.length !== state.targetTabIds.length) {
                 await updateState({ targetTabIds: newTargets });
            }
        }
    }

    if (msg.action === "DISENGAGE_ALL") {
        if (state.agentTabId) chrome.tabs.sendMessage(state.agentTabId, { action: "DISENGAGE_LOCAL" }).catch(() => {});
        state.targetTabIds.forEach(tId => chrome.tabs.sendMessage(tId, { action: "DISENGAGE_LOCAL" }).catch(() => {}));

        await updateState(DEFAULT_STATE);
        await chrome.storage.session.clear();
        await chrome.storage.session.remove(Object.keys(DEFAULT_STATE));
        await updateState(DEFAULT_STATE);
    }

    // REMOTE_INJECT support for Popup
    if (msg.action === "REMOTE_INJECT") {
         await handleUserPrompt(msg.payload);
    }

    // GENESIS_INPUT_CAPTURED - The trigger for starting the loop
    if (msg.action === "GENESIS_INPUT_CAPTURED") {
        // Consolidate the Genesis Payload into a SINGLE message
        state = await getState();
        let genesisPayload = "";

        // Consume existing queue (System, Memory, Target)
        state.messageQueue.forEach(item => {
             if (item.source === "SYSTEM_INIT") genesisPayload += item.content + "\n\n";
             else genesisPayload += `[${item.source}]\n${item.content}\n\n`;
        });

        // Add User Prompt
        genesisPayload += `[USER REQUEST]\n${msg.payload}`;

        // Replace queue with this single mega-message
        await updateState({
            messageQueue: [{ source: "GENESIS_MEGA_PAYLOAD", content: genesisPayload, timestamp: Date.now() }],
            isGenesisComplete: true
        });

        // Start the machine
        state = await getState();
        if (!state.isAgentBusy) {
            await processQueue();
        }
    }
  });
  return true;
});
