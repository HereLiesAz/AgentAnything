// STATE
let agentTabId = null;
let targetTabIds = new Set();

let messageQueue = []; 
let isAgentBusy = false; 
let isGenesisComplete = false; // "Have we done the setup dance?"

// STORAGE FOR THE INTERCEPTED PROMPT
let pendingGenesisPrompt = null; 

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

function addToQueue(source, content, forceImmediate = false) {
    // Standard Queue Item
    const item = { source, content, timestamp: Date.now() };
    
    if (forceImmediate) {
        // High Priority (Used for the very first instruction packet)
        messageQueue.unshift(item);
    } else {
        messageQueue.push(item);
    }
    
    processQueue();
}

function processQueue() {
    // 1. STRICT LOCK: If agent is thinking, we DO NOT disturb it.
    if (isAgentBusy || !agentTabId || messageQueue.length === 0) return;

    // 2. Lock
    isAgentBusy = true;
    
    // 3. Dequeue
    const item = messageQueue.shift();
    
    // 4. Wrap & Send
    // Note: We don't wrap the SYSTEM_INSTRUCTIONS in the "Incoming Transmission" wrapper
    // because it *is* the protocol definition.
    let finalPayload = "";
    
    if (item.source === "SYSTEM_INIT") {
        finalPayload = item.content; // Raw injection for instructions
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

    chrome.tabs.sendMessage(agentTabId, { 
        action: "INJECT_PROMPT", 
        payload: finalPayload 
    }).catch(err => {
        console.warn("Agent unreachable");
        isAgentBusy = false;
    });
}

// --- SEQUENCER ---
async function handleUserPrompt(userText) {
    // Scenario 1: First Run (Genesis)
    if (!isGenesisComplete) {
        console.log("[Sequencer] GENESIS TRIGGERED. Intercepting User Prompt.");
        
        // 1. Stash the user's actual request
        pendingGenesisPrompt = userText;
        
        // 2. Queue Step 1: System Instructions
        // This goes FIRST. Since isAgentBusy is false, it fires immediately.
        addToQueue("SYSTEM_INIT", SYSTEM_INSTRUCTIONS, true);
        
        // 3. Queue Step 2: Target Map
        // We fetch the latest map from storage
        const store = await chrome.storage.session.get(['lastTargetPayload']);
        const mapContent = store.lastTargetPayload ? store.lastTargetPayload.content : "NO TARGET CONNECTED YET";
        
        // This sits in the queue. It will only fire AFTER the agent replies [WAITING] to the instructions.
        addToQueue("TARGET", mapContent);
        
        // 4. Queue Step 3: The User's Original Prompt
        // This sits behind the map.
        addToQueue("USER", pendingGenesisPrompt);
        
        isGenesisComplete = true;
        
    } else {
        // Scenario 2: Normal Operation
        // Just add to queue. It waits its turn.
        addToQueue("USER", userText);
    }
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const senderTabId = sender.tab ? sender.tab.id : null;

    // 1. HEARTBEAT
    if (msg.action === "HELLO" && senderTabId) {
        if (agentTabId === senderTabId) chrome.tabs.sendMessage(senderTabId, { action: "INIT_AGENT" });
        else if (targetTabIds.has(senderTabId)) chrome.tabs.sendMessage(senderTabId, { action: "INIT_TARGET" });
        return;
    }

    // 2. ROLE ASSIGNMENT
    if (msg.action === "ASSIGN_ROLE") {
      const targetId = msg.tabId;
      if (msg.role === "AGENT") {
        agentTabId = targetId;
        targetTabIds.delete(targetId);
        
        // RESET GENESIS
        messageQueue = [];
        isAgentBusy = false;
        isGenesisComplete = false; 
        pendingGenesisPrompt = null;
        
        chrome.tabs.sendMessage(targetId, { action: "INIT_AGENT" });
      } else {
        targetTabIds.add(targetId);
        if (agentTabId === targetId) agentTabId = null;
        chrome.tabs.sendMessage(targetId, { action: "INIT_TARGET" });
      }
    }

    // 3. THE TURN SWITCH
    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled [WAITING]. Unlock.");
        
        // Wait a beat for the UI to settle, then unlock
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); 
        }, 2000); 
    }

    // 4. INPUT INTERCEPTION
    if (msg.action === "QUEUE_INPUT") {
        handleUserPrompt(msg.payload);
    }

    // 5. TARGET UPDATES
    if (msg.action === "TARGET_UPDATE") {
        // Update storage so Genesis can find it later
        await chrome.storage.session.set({ lastTargetPayload: msg.payload });
        
        // If we are already running, queue the update as an event
        if (isGenesisComplete) {
            addToQueue("TARGET", msg.payload.content);
        }
    }

    // 6. EXECUTION
    if (msg.action === "AGENT_COMMAND") {
        targetTabIds.forEach(tId => {
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload }).catch(() => targetTabIds.delete(tId));
        });
    }

    if (msg.action === "DISENGAGE_ALL") {
        agentTabId = null;
        targetTabIds.clear();
        messageQueue = [];
        isAgentBusy = false;
        isGenesisComplete = false;
    }

  })();
  return true;
});
