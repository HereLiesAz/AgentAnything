// STATE MANAGEMENT
let agentTabId = null;
let targetTabIds = new Set();
let messageQueue = []; 
let isAgentBusy = false; 

// THE "GHOST" PROMPT - Automatically prepended to every transmission.
const SYSTEM_PROTOCOL = `
[SYSTEM HOST]: CONNECTED
[PROTOCOL]: STRICT JSON-RPC
[ROLE]: You are AgentAnything. You control a remote browser tab.

[COMMANDS]:
1. INTERACT: \`\`\`json { "tool": "interact", "id": "...", "action": "click"|"type", "value": "..." } \`\`\`
2. BROWSER:  \`\`\`json { "tool": "browser", "action": "refresh"|"back"|"find", "value": "..." } \`\`\`

[RULES]:
1. Analyze the [INCOMING TRANSMISSION] queue.
2. Output JSON commands if action is required.
3. CRITICAL: You MUST end your response with the strictly distinct token: "[WAITING]"
4. The system will NOT send you new data until it sees "[WAITING]".
`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }); 
});

// --- QUEUE LOGIC ---
function addToQueue(source, content) {
    messageQueue.push({ source, content, timestamp: Date.now() });
    processQueue();
}

function processQueue() {
    // 1. Check Lock and Queue Status
    if (isAgentBusy || !agentTabId || messageQueue.length === 0) return;

    // 2. Lock the Agent
    isAgentBusy = true;
    
    // 3. Dequeue Item
    const item = messageQueue.shift();
    
    // 4. Construct Payload with Auto-Prime
    const finalPayload = `
${SYSTEM_PROTOCOL}

[INCOMING TRANSMISSION]
SOURCE: ${item.source}
TIMESTAMP: ${new Date(item.timestamp).toLocaleTimeString()}
--------------------------------------------------
${item.content}
--------------------------------------------------
[INSTRUCTION]: Process this update. Remember to end with "[WAITING]".
`;

    console.log(`[Queue] Dispatching ${item.source} to Agent`);
    
    // 5. Send to Agent
    chrome.tabs.sendMessage(agentTabId, { 
        action: "INJECT_PROMPT", 
        payload: finalPayload 
    }).catch(err => {
        console.warn("Agent unreachable. Releasing lock.");
        isAgentBusy = false;
    });
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab ? sender.tab.id : null;

    if (msg.action === "ASSIGN_ROLE") {
      if (msg.role === "AGENT") {
        agentTabId = msg.tabId;
        targetTabIds.delete(tabId);
        messageQueue = [];
        isAgentBusy = false;
        if(tabId) chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
      } else {
        targetTabIds.add(msg.tabId);
        if (agentTabId === msg.tabId) agentTabId = null;
        if(tabId) chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET" });
      }
    }

    // THE UNLOCK KEY: Agent finished generating
    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled READY. Waiting 2s before next turn...");
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); 
        }, 2000); // 2 Second Safety Delay
    }

    if (msg.action === "QUEUE_INPUT") {
        addToQueue(msg.source || "USER", msg.payload);
    }

    if (msg.action === "REMOTE_INJECT") {
         addToQueue("ADMIN", msg.payload);
    }

    if (msg.action === "TARGET_UPDATE") {
        addToQueue("TARGET", msg.payload.content);
    }

    if (msg.action === "AGENT_COMMAND") {
        targetTabIds.forEach(tId => {
            if (tId) chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload });
        });
    }

    if (msg.action === "DISENGAGE_ALL") {
        agentTabId = null;
        targetTabIds.clear();
        messageQueue = [];
        isAgentBusy = false;
    }

  })();
  return true;
});
