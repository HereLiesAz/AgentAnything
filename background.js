// STATE
let agentTabId = null;
let targetTabIds = new Set();
let messageQueue = []; 
let isAgentBusy = false; 

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

// --- QUEUE ---
function addToQueue(source, content) {
    messageQueue.push({ source, content, timestamp: Date.now() });
    processQueue();
}

function processQueue() {
    if (isAgentBusy || !agentTabId || messageQueue.length === 0) return;

    isAgentBusy = true;
    const item = messageQueue.shift();
    
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

    console.log(`[Queue] Dispatching ${item.source}`);
    
    // Check if agent is alive before sending
    chrome.tabs.sendMessage(agentTabId, { 
        action: "INJECT_PROMPT", 
        payload: finalPayload 
    }).catch(err => {
        console.warn("Agent unreachable (Tab Closed?)");
        agentTabId = null;
        isAgentBusy = false;
    });
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const senderTabId = sender.tab ? sender.tab.id : null;

    // 1. HEARTBEAT / RECOVERY
    if (msg.action === "HELLO" && senderTabId) {
        // If the tab just woke up, check if it's supposed to be someone
        if (agentTabId === senderTabId) {
            console.log(`[Recovery] Re-initializing Agent ${senderTabId}`);
            chrome.tabs.sendMessage(senderTabId, { action: "INIT_AGENT" });
        } else if (targetTabIds.has(senderTabId)) {
            console.log(`[Recovery] Re-initializing Target ${senderTabId}`);
            chrome.tabs.sendMessage(senderTabId, { action: "INIT_TARGET" });
        }
        return;
    }

    // 2. ROLE ASSIGNMENT
    if (msg.action === "ASSIGN_ROLE") {
      const targetId = msg.tabId; // THE FIX: Use the payload ID, not the sender ID
      
      if (msg.role === "AGENT") {
        agentTabId = targetId;
        targetTabIds.delete(targetId);
        messageQueue = [];
        isAgentBusy = false;
        
        console.log(`[System] Assigning AGENT to Tab ${targetId}`);
        chrome.tabs.sendMessage(targetId, { action: "INIT_AGENT" });
        
      } else {
        targetTabIds.add(targetId);
        if (agentTabId === targetId) agentTabId = null;
        
        console.log(`[System] Assigning TARGET to Tab ${targetId}`);
        chrome.tabs.sendMessage(targetId, { action: "INIT_TARGET" });
      }
    }

    // 3. AGENT SIGNALS
    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled READY.");
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); 
        }, 2000); 
    }

    // 4. DATA FLOW
    if (msg.action === "QUEUE_INPUT") addToQueue(msg.source || "USER", msg.payload);
    if (msg.action === "REMOTE_INJECT") addToQueue("ADMIN", msg.payload);
    if (msg.action === "TARGET_UPDATE") addToQueue("TARGET", msg.payload.content);

    // 5. EXECUTION
    if (msg.action === "AGENT_COMMAND") {
        targetTabIds.forEach(tId => {
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload }).catch(() => {
                targetTabIds.delete(tId); // Cleanup dead targets
            });
        });
    }

    // 6. CLEANUP
    if (msg.action === "DISENGAGE_ALL") {
        agentTabId = null;
        targetTabIds.clear();
        messageQueue = [];
        isAgentBusy = false;
    }

  })();
  return true;
});
