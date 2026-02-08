// STATE
let agentTabId = null;
let targetTabIds = new Set();

let messageQueue = []; 
let isAgentBusy = false; 
let isGenesisComplete = false; 
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
    const item = { source, content, timestamp: Date.now() };
    if (forceImmediate) messageQueue.unshift(item);
    else messageQueue.push(item);
    processQueue();
}

function processQueue() {
    if (isAgentBusy || !agentTabId || messageQueue.length === 0) return;

    isAgentBusy = true;
    const item = messageQueue.shift();
    
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

    chrome.tabs.sendMessage(agentTabId, { 
        action: "INJECT_PROMPT", 
        payload: finalPayload 
    }).catch(err => {
        console.warn("Agent unreachable");
        isAgentBusy = false;
    });
}

// --- SEQUENCER & MEMORY ---
async function handleUserPrompt(userText) {
    if (!isGenesisComplete) {
        console.log("[Sequencer] GENESIS TRIGGERED.");
        pendingGenesisPrompt = userText;
        
        // 1. Queue Protocol
        addToQueue("SYSTEM_INIT", SYSTEM_INSTRUCTIONS, true);
        
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
            addToQueue("CORTEX_MEMORY", contextBlock);
        }
        
        // 3. Queue Target Map
        const mapContent = store.lastTargetPayload ? store.lastTargetPayload.content : "NO TARGET CONNECTED YET";
        addToQueue("TARGET", mapContent);
        
        // 4. Queue User Prompt
        addToQueue("USER", pendingGenesisPrompt);
        
        isGenesisComplete = true;
    } else {
        addToQueue("USER", userText);
    }
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const senderTabId = sender.tab ? sender.tab.id : null;

    if (msg.action === "HELLO" && senderTabId) {
        if (agentTabId === senderTabId) chrome.tabs.sendMessage(senderTabId, { action: "INIT_AGENT" });
        else if (targetTabIds.has(senderTabId)) chrome.tabs.sendMessage(senderTabId, { action: "INIT_TARGET" });
        return;
    }

    if (msg.action === "ASSIGN_ROLE") {
      const targetId = msg.tabId;
      if (msg.role === "AGENT") {
        agentTabId = targetId;
        targetTabIds.delete(targetId);
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

    if (msg.action === "AGENT_READY") {
        console.log("[System] Agent signaled [WAITING]. Unlock.");
        setTimeout(() => {
            isAgentBusy = false;
            processQueue(); 
        }, 2000); 
    }

    if (msg.action === "QUEUE_INPUT") handleUserPrompt(msg.payload);

    if (msg.action === "TARGET_UPDATE") {
        await chrome.storage.session.set({ lastTargetPayload: msg.payload });
        if (isGenesisComplete) addToQueue("TARGET", msg.payload.content);
    }

    if (msg.action === "AGENT_COMMAND") {
        targetTabIds.forEach(tId => {
            chrome.tabs.sendMessage(tId, { action: "EXECUTE_COMMAND", command: msg.payload }).catch(() => targetTabIds.delete(tId));
        });
    }

    if (msg.action === "DISENGAGE_ALL") {
        if (agentTabId) chrome.tabs.sendMessage(agentTabId, { action: "DISENGAGE_LOCAL" }).catch(() => {});
        targetTabIds.forEach(tId => chrome.tabs.sendMessage(tId, { action: "DISENGAGE_LOCAL" }).catch(() => {}));
        agentTabId = null;
        targetTabIds.clear();
        messageQueue = [];
        isAgentBusy = false;
        isGenesisComplete = false;
        await chrome.storage.session.clear();
    }

  })();
  return true;
});
