let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
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

// --- UI COMPONENT: THE GLASS WALL ---
function erectGlassWall() {
    if (document.getElementById('aa-glass-wall')) return;
    
    const wall = document.createElement('div');
    wall.id = 'aa-glass-wall';
    wall.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: transparent;
        z-index: 2147483640; /* Below Deck, Above Page */
        cursor: not-allowed;
    `;
    
    // Stop all events from reaching the page
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress'].forEach(evt => {
        wall.addEventListener(evt, (e) => {
            e.stopPropagation();
            e.preventDefault();
        }, true);
    });
    
    document.body.appendChild(wall);
    console.log("AgentAnything: Glass Wall Erected. Interaction Blocked.");
}

// --- AGENT LOGIC ---

function initAgentUI() {
  console.log("%c AGENT ACTIVATED ", "background: #000; color: #0f0; font-size: 20px;");
  
  erectGlassWall();
  createObservationDeck(true); // true = enable input

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
        // Auto-inject System Prompt immediately
        queueMessage(prompt);
        window.hasInitialized = true;
    }
    
    observeAIOutput();
  });
}

function createObservationDeck(enableInput) {
  if (document.getElementById('aa-observation-deck')) return;
  
  observationDeck = document.createElement('div');
  observationDeck.id = 'aa-observation-deck';
  observationDeck.style.cssText = `
    position: fixed; top: 0; right: 0; width: 350px; background: #050505; color: #0f0;
    border-left: 1px solid #333; height: 100vh; z-index: 2147483647; padding: 10px;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; display: flex; flex-direction: column;
    box-shadow: -5px 0 20px rgba(0,0,0,0.8);
  `;

  // Log Area
  const logArea = document.createElement('div');
  logArea.id = 'aa-log-area';
  logArea.style.cssText = "flex: 1; overflow-y: auto; white-space: pre-wrap; padding-bottom: 10px; scrollbar-width: none;";
  observationDeck.appendChild(logArea);

  // Input Area (Agent Only)
  if (enableInput) {
      const inputContainer = document.createElement('div');
      inputContainer.style.cssText = "border-top: 1px solid #333; padding-top: 10px; display: flex; gap: 5px;";
      
      const input = document.createElement('input');
      input.id = 'aa-master-input';
      input.placeholder = "Command the Agent...";
      input.style.cssText = "flex: 1; background: #111; color: #fff; border: 1px solid #333; padding: 5px; font-family: inherit;";
      
      const btn = document.createElement('button');
      btn.innerText = "SEND";
      btn.style.cssText = "background: #0f0; color: #000; border: none; padding: 5px 10px; cursor: pointer; font-weight: bold;";
      
      // Send Logic
      const handleSend = () => {
          const val = input.value.trim();
          if (val) {
              // Log to deck
              const userMsg = document.createElement('div');
              userMsg.style.color = "#fff";
              userMsg.style.borderBottom = "1px solid #333";
              userMsg.innerText = `[USER]: ${val}`;
              logArea.appendChild(userMsg);
              logArea.scrollTop = logArea.scrollHeight;
              
              // Queue for injection
              queueMessage(val);
              input.value = "";
          }
      };

      btn.onclick = handleSend;
      input.onkeydown = (e) => { if (e.key === 'Enter') handleSend(); };
      
      // Block event propagation so typing here doesn't trigger page hotkeys
      input.addEventListener('keydown', e => e.stopPropagation());
      input.addEventListener('keyup', e => e.stopPropagation());
      input.addEventListener('keypress', e => e.stopPropagation());

      inputContainer.appendChild(input);
      inputContainer.appendChild(btn);
      observationDeck.appendChild(inputContainer);
      
      // Focus our input, not the page's
      setTimeout(() => input.focus(), 500);
  }

  document.body.appendChild(observationDeck);
}

function observeAIOutput() {
  const observer = new MutationObserver((mutations) => {
    const bodyText = document.body.innerText;
    if (bodyText.match(/```/)) {
        parseCommands(bodyText);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function parseCommands(text) {
  const regex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let rawJson = match[1];
    try {
      const json = JSON.parse(rawJson);
      dispatchIfNew(json);
    } catch (e) {
      try {
        const cleanJson = sanitizeJson(rawJson);
        const json = JSON.parse(cleanJson);
        dispatchIfNew(json);
      } catch (e2) {
        console.error("AgentAnything: FATAL JSON ERROR.", e2);
      }
    }
  }
}

function sanitizeJson(str) {
  return str
    .replace(/\/\/.*$/gm, '') 
    .replace(/\/\*[\s\S]*?\*\//g, '') 
    .replace(/'/g, '"') 
    .replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
}

function dispatchIfNew(json) {
  const sig = JSON.stringify(json);
  if (sig !== lastCommandSignature) {
    lastCommandSignature = sig;
    console.log("Dispatching command:", json);
    
    chrome.runtime.sendMessage({ 
      action: "AGENT_COMMAND", 
      payload: { ...json, targetTabId: window.activeTargetId } 
    });
    
    const logArea = document.getElementById('aa-log-area');
    if (logArea) {
        const line = document.createElement('div');
        line.style.color = "#888";
        line.innerText = `>> COMMAND SENT: ${json.action}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
  }
}

// --- STEALTH QUEUE SYSTEM ---

function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;
  createObservationDeck(true);
  
  updateVisualDeck(payload);

  let aiMessage = "";
  if (payload.type === "APPEND") {
    aiMessage = `\n[TARGET UPDATE]:\n${payload.content}`;
  } else {
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

function stealthTypeAndSend(text, retries = 0, callback) {
    const input = Heuristics.findBestInput();
    
    // RETRY LOGIC
    if (!input) {
        if (retries < 5) {
            console.log(`AgentAnything: Input not found. Retrying (${retries + 1}/5)...`);
            setTimeout(() => stealthTypeAndSend(text, retries + 1, callback), 1000);
            return;
        }
        
        // Alert in the Deck, not the page
        const logArea = document.getElementById('aa-log-area');
        if (logArea) {
            const err = document.createElement('div');
            err.style.color = "red";
            err.innerText = "FATAL: CANNOT FIND AI INPUT BOX.";
            logArea.appendChild(err);
        }
        
        if (callback) callback();
        return;
    }

    // 1. SET VALUE
    try {
        // Temporarily bypass the glass wall for programmatic focus
        // We don't remove the wall, just assume scripts can bypass pointer-events
        input.focus();
        
        // React/Vue Value Setter Bypass
        let nativeSetter;
        if (input instanceof HTMLTextAreaElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        } else if (input instanceof HTMLInputElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        }

        if (nativeSetter) {
            const currentVal = input.value;
            if (!currentVal.endsWith(text)) {
                 const newVal = currentVal ? currentVal + "\n" + text : text;
                 nativeSetter.call(input, newVal);
            }
        } else {
            if (!input.innerText.endsWith(text)) {
                input.innerText = input.innerText + "\n" + text;
            }
        }
        
        const events = ['beforeinput', 'input', 'change'];
        events.forEach(eventType => {
            input.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
        });
        
    } catch (e) {
        console.error("AgentAnything: Input Injection Failed", e);
    }

    // 2. TRIGGER SEND
    setTimeout(() => {
        const sendBtn = Heuristics.findSendButton();
        
        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
        } else {
            // Fallback: Enter Key
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 13, key: 'Enter' }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, keyCode: 13, key: 'Enter' }));
        }
        
        if (callback) callback();
    }, 800);
}

function updateVisualDeck(payload) {
    const logArea = document.getElementById('aa-log-area');
    if (!logArea) return;

    if (payload.type === "APPEND") {
        const div = document.createElement('div');
        div.innerText = payload.content;
        div.style.borderLeft = "2px solid #0f0";
        div.style.marginTop = "5px";
        div.style.paddingLeft = "5px";
        div.style.opacity = "0.7";
        logArea.appendChild(div);
    } else {
        const header = document.createElement('div');
        header.style.cssText = "color:#666;border-bottom:1px solid #333;margin-top:10px;";
        header.innerText = `CONNECTED TO: ${payload.url}`;
        logArea.appendChild(header);

        const div = document.createElement('div');
        div.innerText = payload.content;
        div.style.fontSize = "9px";
        div.style.opacity = "0.5";
        logArea.appendChild(div);
    }
    logArea.scrollTop = logArea.scrollHeight;
}


// --- TARGET LOGIC ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  erectGlassWall(); // Targets are seen, not touched.

  const indicator = document.createElement('div');
  indicator.innerText = "TARGET LOCKED";
  indicator.style.cssText = "position:fixed;bottom:10px;right:10px;background:red;color:white;padding:5px 10px;z-index:2147483647;font-size:12px;font-family:monospace;pointer-events:none;box-shadow: 0 0 10px red;";
  document.body.appendChild(indicator);

  setTimeout(() => {
      if (typeof Heuristics === 'undefined') return;

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
${contentNode.innerText.substring(0, 5000)}
`;
    chrome.runtime.sendMessage({
      action: "TARGET_UPDATE",
      payload: { type: "FULL", content: fullReport, url: window.location.href }
    });

  }, 1000);
}

function executeCommand(cmd) {
    if (cmd.tool === "interact") {
        const el = document.querySelector(`[data-aa-id="${cmd.id}"]`);
        if (el) {
            if (cmd.action === "click") el.click();
            if (cmd.action === "type") {
                el.value = cmd.value;
                el.dispatchEvent(new Event('input', {bubbles:true}));
            }
            // Report back
            setTimeout(() => {
                chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `Action ${cmd.action} performed on ${cmd.id}.` }
                });
            }, 500);
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        chrome.runtime.sendMessage({
            action: "TARGET_UPDATE",
            payload: { type: "APPEND", content: `Text search for '${cmd.value}': ${found ? "FOUND" : "NOT FOUND"}` }
        });
    }
}
