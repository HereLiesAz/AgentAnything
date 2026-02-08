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
    
    if (agentTabId) {
        chrome.tabs.sendMessage(agentTabId, { 
            action: "INJECT_PROMPT", 
            payload: finalPayload 
        }).catch(err => {
            console.warn("Agent unreachable");
            isAgentBusy = false;
        });
    } else {
        isAgentBusy = false;
    }
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

    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled READY.");
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); 
        }, 2000); 
    }

    if (msg.action === "QUEUE_INPUT") addToQueue(msg.source || "USER", msg.payload);
    if (msg.action === "REMOTE_INJECT") addToQueue("ADMIN", msg.payload);
    if (msg.action === "TARGET_UPDATE") addToQueue("TARGET", msg.payload.content);

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
