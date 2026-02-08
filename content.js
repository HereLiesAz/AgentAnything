let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
let lastReportedContent = "";
let knownDomainContexts = new Set(); 
let observationDeck = null;

// --- MESSAGE QUEUE SYSTEM ---
let messageQueue = [];
let isProcessingQueue = false;

// --- INITIALIZATION HANDSHAKE ---
chrome.runtime.sendMessage({ action: "HELLO" });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        initAgentUI();
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        initTargetLogic();
      }
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "INJECT_OBSERVATION":
      if (role === "AGENT") injectObservation(msg.sourceId, msg.payload);
      break;
  }
});

// --- AGENT LOGIC ---

function initAgentUI() {
  console.log("%c AGENT ACTIVATED ", "background: #000; color: #0f0; font-size: 20px;");
  createObservationDeck();

  chrome.storage.sync.get({ universalContext: '' }, (items) => {
    const universal = items.universalContext ? `\n\n[UNIVERSAL CONTEXT]:\n${items.universalContext}` : "";

    const prompt = `
[SYSTEM: YOU ARE AN AGENT. YOU CONTROL A BROWSER TAB.]
I have connected you to a target tab.
Use the following JSON commands to manipulate it. 
Output ONLY raw JSON.

1. INTERACT WITH PAGE (Click/Type):
\`\`\`json
{
  "tool": "interact",
  "id": "ELEMENT_ID", 
  "action": "click" | "type" | "read",
  "value": "text" (for type)
}
\`\`\`

2. BROWSER CONTROL (Nav/Search):
\`\`\`json
{
  "tool": "browser",
  "action": "refresh" | "back" | "forward" | "find",
  "value": "search term" (only for find)
}
\`\`\`
${universal}

[SYSTEM]: Connection Established. Waiting for user instruction or Target map...
    `;
    
    if (!window.hasInitialized) {
        queueMessage(prompt);
        window.hasInitialized = true;
    }
    
    observeAIOutput();
  });
}

function createObservationDeck() {
  if (document.getElementById('aa-observation-deck')) return;
  
  observationDeck = document.createElement('div');
  observationDeck.id = 'aa-observation-deck';
  observationDeck.style.cssText = `
    position: fixed; top: 0; right: 0; width: 300px; background: #050505; color: #0f0;
    border-left: 1px solid #333; height: 100vh; z-index: 2147483647; padding: 10px;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 10px; white-space: pre-wrap; 
    overflow-y: auto; opacity: 0.9; pointer-events: none;
  `;
  document.body.appendChild(observationDeck);
}

function observeAIOutput() {
  const observer = new MutationObserver((mutations) => {
    const bodyText = document.body.innerText;
    if (bodyText.includes('```json') && bodyText.includes('```')) {
        parseCommands(bodyText);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function parseCommands(text) {
  const regex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const sig = JSON.stringify(json);
      
      if (sig !== lastCommandSignature) {
        lastCommandSignature = sig;
        console.log("Dispatching command:", json);
        
        chrome.runtime.sendMessage({ 
          action: "AGENT_COMMAND", 
          payload: { ...json, targetTabId: window.activeTargetId } 
        });
        
        const line = document.createElement('div');
        line.style.color = "#888";
        line.innerText = `>> COMMAND SENT: ${json.action}`;
        observationDeck.appendChild(line);
        observationDeck.scrollTop = observationDeck.scrollHeight;
      }
    } catch (e) {
      console.error("Agent JSON Syntax Error", e);
    }
  }
}

// --- STEALTH QUEUE SYSTEM ---

function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;
  createObservationDeck();
  
  updateVisualDeck(payload);

  let aiMessage = "";
  if (payload.type === "APPEND") {
    aiMessage = `\n[TARGET UPDATE]:\n${payload.content}`;
  } else {
    // Check Cortex Memory
    if (payload.url) {
        try {
            const hostname = new URL(payload.url).hostname.replace(/^www\./, '');
            if (!knownDomainContexts.has(hostname)) {
                 knownDomainContexts.add(hostname);
            }
        } catch(e) {}
    }
    aiMessage = `\n[TARGET CONNECTED]:\n${payload.content}`;
  }

  queueMessage(aiMessage);
}

function queueMessage(text) {
    messageQueue.push(text);
    processQueue();
}

function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;
    const text = messageQueue.shift();

    stealthTypeAndSend(text, 0, () => {
        isProcessingQueue = false;
        setTimeout(processQueue, 1500); 
    });
}

/**
 * THE HARDENED STEALTH INJECTOR
 * Supports TextArea, Input, and ContentEditable.
 * Includes Retry Logic if input is missing (loading state).
 */
function stealthTypeAndSend(text, retries = 0, callback) {
    const input = document.querySelector('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    
    // RETRY LOGIC
    if (!input) {
        if (retries < 5) {
            console.log(`AgentAnything: Input not found. Retrying (${retries + 1}/5)...`);
            setTimeout(() => stealthTypeAndSend(text, retries + 1, callback), 1000);
            return;
        }
        console.warn("AgentAnything: Could not find chat input box after retries.");
        if (callback) callback();
        return;
    }

    // 1. SET VALUE (Stealthily - No Focus)
    try {
        let nativeSetter;
        
        // Detect element type to use correct prototype
        if (input instanceof HTMLTextAreaElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        } else if (input instanceof HTMLInputElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        }

        if (nativeSetter) {
            const currentVal = input.value;
            const newVal = currentVal ? currentVal + "\n" + text : text;
            nativeSetter.call(input, newVal);
        } else {
            // ContentEditable fallback
            input.innerText = text;
        }
        
        // Dispatch events to trigger framework state updates
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
        console.error("AgentAnything: Input Injection Failed", e);
    }

    // 2. TRIGGER SEND
    setTimeout(() => {
        const sendBtn = document.querySelector('button[aria-label="Send"], button[data-testid="send-button"], button[aria-label="Submit"]');
        
        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
        } else {
            // Fallback: Full Enter Key Sequence
            ['keydown', 'keypress', 'keyup'].forEach(type => {
                input.dispatchEvent(new KeyboardEvent(type, {
                    bubbles: true, 
                    cancelable: true, 
                    keyCode: 13, 
                    key: 'Enter',
                    code: 'Enter',
                    which: 13
                }));
            });
        }
        
        if (callback) callback();
    }, 500);
}

function updateVisualDeck(payload) {
    if (payload.type === "APPEND") {
        const div = document.createElement('div');
        div.innerText = payload.content;
        div.style.borderLeft = "2px solid #0f0";
        div.style.marginTop = "5px";
        div.style.paddingLeft = "5px";
        observationDeck.appendChild(div);
    } else {
        observationDeck.innerHTML = `<div style="color:#666;border-bottom:1px solid #333">CONNECTED TO: ${payload.url}</div>`;
        const div = document.createElement('div');
        div.innerText = payload.content;
        observationDeck.appendChild(div);
    }
    observationDeck.scrollTop = observationDeck.scrollHeight;
}


// --- TARGET LOGIC (THE BODY) ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  const indicator = document.createElement('div');
  indicator.innerText = "TARGET";
  indicator.style.cssText = "position:fixed;bottom:10px;right:10px;background:red;color:white;padding:2px 5px;z-index:999999;font-size:10px;font-family:monospace;pointer-events:none;opacity:0.5;";
  document.body.appendChild(indicator);

  setTimeout(() => {
      // Safety check: ensure Heuristics is loaded
      if (typeof Heuristics === 'undefined') {
          console.error("AgentAnything: Heuristics library missing!");
          return;
      }

      const map = Heuristics.generateMap();
      targetMap = map;
      const contentNode = Heuristics.findMainContent();
      
      const toolSchema = map.map(item => {
        return `ID: "${item.id}" | Type: ${item.tag} | Text: "${item.text}"`;
      }).join('\n');

      const fullReport = `
TARGET: ${document.title}
URL: ${window.location.href}

ELEMENTS:
${toolSchema}

CONTENT:
${contentNode.innerText.substring(
