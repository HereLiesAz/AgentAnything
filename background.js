// STATE MANAGEMENT
let agentTabId = null;
let targetTabIds = new Set();
let messageQueue = []; // FIFO Queue: { source: "USER"|"TARGET", content: "..." }
let isAgentBusy = false; // The Global Lock

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }); 
});

// --- QUEUE LOGIC ---
function addToQueue(source, content) {
    console.log(`[Queue] Adding item from ${source}`);
    messageQueue.push({ source, content, timestamp: Date.now() });
    processQueue();
}

function processQueue() {
    if (isAgentBusy || !agentTabId || messageQueue.length === 0) return;

    // Lock the Agent
    isAgentBusy = true;
    
    // Get next item
    const item = messageQueue.shift();
    
    // Construct Payload
    const payload = `
[INCOMING TRANSMISSION]
SOURCE: ${item.source}
TIMESTAMP: ${new Date(item.timestamp).toLocaleTimeString()}
--------------------------------------------------
${item.content}
--------------------------------------------------
[INSTRUCTION]: Process this update. Output JSON commands if needed. 
YOU MUST END YOUR RESPONSE WITH THE TEXT: "[WAITING]"
`;

    // Send to Agent
    console.log(`[Queue] Dispatching to Agent (Queue Size: ${messageQueue.length})`);
    chrome.tabs.sendMessage(agentTabId, { 
        action: "INJECT_PROMPT", 
        payload: payload 
    }).catch(err => {
        console.error("Agent unreachable, releasing lock.", err);
        isAgentBusy = false;
    });
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab ? sender.tab.id : null;

    // 1. ROLE ASSIGNMENT
    if (msg.action === "ASSIGN_ROLE") {
      if (msg.role === "AGENT") {
        agentTabId = msg.tabId;
        targetTabIds.delete(tabId);
        messageQueue = []; // Clear queue on new agent
        isAgentBusy = false;
        console.log(`[System] Agent Assigned: ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
      } else {
        targetTabIds.add(msg.tabId);
        if (agentTabId === msg.tabId) agentTabId = null;
        console.log(`[System] Target Assigned: ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET" });
      }
      return;
    }

    // 2. AGENT SIGNALING "I AM DONE"
    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled READY. Releasing lock in 2s...");
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); // Try to send next item
        }, 2000); // 2 Second Safety Delay
    }

    // 3. INPUTS TO QUEUE
    if (msg.action === "QUEUE_INPUT") {
        addToQueue(msg.source || "USER", msg.payload);
    }

    // 4. TARGET UPDATES TO QUEUE
    if (msg.action === "TARGET_UPDATE") {
        // Only queue if it's a meaningful update or specifically requested
        // For high-frequency updates, we might want to debounce here, 
        // but for now, we trust the Target's debouncer.
        addToQueue("TARGET", msg.payload.content);
        
        // Also forward immediate state for the parser (if needed)
        // chrome.storage.session.set({ lastTargetPayload: msg.payload });
    }

    // 5. AGENT COMMANDS (Execution)
    if (msg.action === "AGENT_COMMAND") {
        // Execute on ALL targets for now, or specific one if ID provided
        targetTabIds.forEach(tId => {
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload });
        });
    }

    if (msg.action === "DISENGAGE_ALL") {
        agentTabId = null;
        targetTabIds.clear();
        messageQueue = [];
        isAgentBusy = false;
    }

    if (msg.action === "HELLO") { /* Heartbeat, ignore */ }

  })();
  return true;
});
