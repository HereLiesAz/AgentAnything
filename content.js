let role = null;
let myTabId = null;
let targetMap = [];
let agentMap = []; // NEW: Agent maps itself
let lastCommandSignature = "";
let knownDomainContexts = new Set(); 
let uiPanel = null;
let inputGuardActive = false;

// --- MESSAGE QUEUE ---
let messageQueue = [];
let isProcessingQueue = false;

// --- INITIALIZATION ---
chrome.runtime.sendMessage({ action: "HELLO" });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        initAgent();
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        initTarget();
      }
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "INJECT_UPDATE":
      if (role === "AGENT") injectUpdate(msg.sourceId, msg.payload);
      break;
    case "DISENGAGE_LOCAL":
      disengageLocal();
      break;
  }
});

function disengageLocal() {
    if (uiPanel) uiPanel.remove();
    const guard = document.getElementById('aa-input-lock');
    if (guard) guard.remove();
    const badge = document.getElementById('aa-badge');
    if (badge) badge.remove();
    window.location.reload();
}

// --- UI: EVENT-BASED INPUT GUARD ---
function enableInputGuard() {
    if (inputGuardActive) return;
    inputGuardActive = true;
    
    const blockEvent = (e) => {
        if (e.target.closest('#aa-interface')) return;
        if (!e.isTrusted) return; // Allow scripts
        e.stopPropagation();
        e.preventDefault();
    };
    
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'focus', 'submit'].forEach(evt => {
        window.addEventListener(evt, blockEvent, true); 
    });

    const badge = document.createElement('div');
    badge.id = 'aa-badge';
    badge.innerText = "🔒 AGENT ACTIVE";
    badge.style.cssText = `
        position: fixed; top: 10px; right: 10px; 
        background: #2e3440; color: #88c0d0; padding: 4px 8px; 
        border: 1px solid #4c566a; border-radius: 4px;
        font-family: monospace; font-size: 10px; pointer-events: none; z-index: 2147483647;
    `;
    document.body.appendChild(badge);
}

// --- AGENT INTERFACE ---

function initAgent() {
  // 1. Self-Map to find our own controls
  setTimeout(() => {
      agentMap = Heuristics.generateMap();
      console.log("[System] Agent Self-Map Complete:", agentMap);
  }, 1000);

  createInterface(true); 

  chrome.storage.sync.get({ universalContext: '' }, (items) => {
    const universal = items.universalContext ? `\n\n[CONTEXT]:\n${items.universalContext}` : "";

    const systemPrompt = `
[SYSTEM: AGENT ROLE ACTIVE]
Target connected. Protocol: JSON.
Output only raw JSON.

1. INTERACTION:
\`\`\`json
{
  "tool": "interact",
  "id": "ELEMENT_ID", 
  "action": "click" | "type" | "read",
  "value": "text"
}
\`\`\`

2. NAVIGATION:
\`\`\`json
{
  "tool": "browser",
  "action": "refresh" | "back" | "forward" | "find",
  "value": "term"
}
\`\`\`
${universal}

[SYSTEM]: Ready. Waiting for target.
    `;
    
    if (!window.hasInitialized) {
        queueMessage(systemPrompt);
        window.hasInitialized = true;
        setTimeout(enableInputGuard, 2000);
    }
    
    observeAgentOutput();
  });
}

function createInterface(enableInput) {
  if (document.getElementById('aa-interface')) return;
  
  uiPanel = document.createElement('div');
  uiPanel.id = 'aa-interface';
  uiPanel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; width: 400px; 
    background: rgba(30, 30, 30, 0.95); color: #e0e0e0;
    border: 1px solid #444; border-radius: 6px;
    z-index: 2147483647; display: flex; flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    max-height: 50vh; overflow: hidden;
  `;

  // Header with Disengage
  const header = document.createElement('div');
  header.style.cssText = "padding: 5px 10px; background: #252525; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center;";
  
  const title = document.createElement('span');
  title.innerText = role === "AGENT" ? "AGENT CONTROL" : "TARGET MONITOR";
  title.style.fontWeight = "bold";
  
  const disengageBtn = document.createElement('button');
  disengageBtn.innerText = "DISENGAGE";
  disengageBtn.style.cssText = "background: #bf616a; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 10px; padding: 2px 6px;";
  disengageBtn.onclick = () => {
      chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
  };
  
  header.appendChild(title);
  header.appendChild(disengageBtn);
  uiPanel.appendChild(header);

  // Log Area
  const logArea = document.createElement('div');
  logArea.id = 'aa-log-area';
  logArea.style.cssText = `
    flex: 1; overflow-y: auto; padding: 10px; white-space: pre-wrap; 
    border-bottom: 1px solid #444; scrollbar-width: none;
  `;
  uiPanel.appendChild(logArea);

  // Input Area
  if (enableInput) {
      const inputContainer = document.createElement('div');
      inputContainer.style.cssText = "padding: 8px; display: flex; background: #252525;";
      
      const input = document.createElement('input');
      input.id = 'aa-cmd-input';
      input.placeholder = "Enter instructions...";
      input.style.cssText = `
        flex: 1; background: #1a1a1a; color: #fff; 
        border: 1px solid #444; border-radius: 4px; padding: 6px 10px;
        font-family: inherit; outline: none;
      `;
      
      const handleSend = () => {
          const val = input.value.trim();
          if (val) {
              const userMsg = document.createElement('div');
              userMsg.style.cssText = "color: #fff; margin-bottom: 4px; font-weight: 500;";
              userMsg.innerText = `> ${val}`;
              logArea.appendChild(userMsg);
              logArea.scrollTop = logArea.scrollHeight;
              queueMessage(val);
              input.value = "";
          }
      };

      input.onkeydown = (e) => { 
          if (e.key === 'Enter') handleSend(); 
          e.stopPropagation();
      };
      
      inputContainer.appendChild(input);
      uiPanel.appendChild(inputContainer);
  }

  document.body.appendChild(uiPanel);
}

function observeAgentOutput() {
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
        console.error("JSON Parse Error", e2);
      }
    }
  }
}

function sanitizeJson(str) {
  return str.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
}

function dispatchIfNew(json) {
  const sig = JSON.stringify(json);
  if (sig !== lastCommandSignature) {
    lastCommandSignature = sig;
    chrome.runtime.sendMessage({ 
      action: "AGENT_COMMAND", 
      payload: { ...json, targetTabId: window.activeTargetId } 
    });
    const logArea = document.getElementById('aa-log-area');
    if (logArea) {
        const line = document.createElement('div');
        line.style.cssText = "color: #88c0d0; margin-bottom: 4px; font-size: 12px;";
        line.innerText = `Running: ${json.action} (${json.tool})`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
  }
}

// --- QUEUE & INJECTION ---

function injectUpdate(sourceId, payload) {
  window.activeTargetId = sourceId;
  createInterface(true);
  
  if (payload.type === "APPEND") {
      updateLog(payload.content, "APPEND");
      queueMessage(`\n[UPDATE]:\n${payload.content}`);
  } else {
      updateLog(`Connected: ${payload.url}`, "INFO");
      queueMessage(`\n[CONNECTED]:\n${payload.content}`);
  }
}

function queueMessage(text) {
    messageQueue.push(text);
    processQueue();
}

function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;
    const text = messageQueue.shift();
    visualTypeAndSend(text, 0, () => {
        isProcessingQueue = false;
        setTimeout(processQueue, 1500); 
    });
}

// --- AUTOMATION ENGINE ---

async function visualTypeAndSend(text, retries = 0, callback) {
    // Refresh self-map to ensure we have latest IDs
    agentMap = Heuristics.generateMap();
    
    const input = Heuristics.findBestInput();
    
    if (!input) {
        if (retries < 3) {
            setTimeout(() => visualTypeAndSend(text, retries + 1, callback), 1000);
            return;
        }
        if (callback) callback();
        return;
    }

    try {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        
        let nativeSetter;
        if (input instanceof HTMLTextAreaElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        } else if (input instanceof HTMLInputElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        }

        let currentVal = input.value || "";
        if (currentVal && !currentVal.endsWith('\n')) currentVal += "\n";
        
        if (nativeSetter) {
             nativeSetter.call(input, currentVal + text);
        } else {
             input.innerText = currentVal + text;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Trigger Submit Logic
        setTimeout(() => triggerHardSubmit(input), 300);
        
    } catch (e) {
        console.error("Injection failed", e);
    }

    setTimeout(() => { if (callback) callback(); }, 1000);
}

function triggerHardSubmit(inputElement) {
    // 1. Try finding specific "Send" button in our Self-Map
    // Look for high-scoring buttons (score > 15 usually implies 'send' or 'submit')
    const probableSend = agentMap.find(item => 
        (item.tag === 'button' || item.type === 'submit') && 
        (item.text.match(/send|submit|go|chat/i) || item.score > 15)
    );

    let sent = false;

    if (probableSend) {
        const el = Heuristics.getElementByAAId(probableSend.id);
        if (el) {
            console.log("[System] Clicking mapped Send button:", probableSend.id);
            el.click();
            sent = true;
        }
    }

    if (!sent) {
        // 2. Heuristic Backup
        const btn = Heuristics.findSendButton();
        if (btn) {
            console.log("[System] Clicking heuristic Send button");
            btn.click();
            sent = true;
        }
    }

    // 3. The "Focus-Hunt" (Tab Simulation)
    // If we haven't sent yet, assume the button is next in tab order
    if (!sent) {
        console.log("[System] Attempting Focus-Hunt Submit...");
        // We can't actually "press tab", but we can find the next focusable element
        const focusables = Array.from(document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
        const index = focusables.indexOf(inputElement);
        if (index > -1 && index < focusables.length - 1) {
            const next = focusables[index + 1];
            if (next) {
                next.focus();
                next.click();
                // If it's not a button, hit enter on it
                next.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 13, key: 'Enter' }));
            }
        }
    }

    // 4. Always Hammer Enter on Input as failsafe
    const keyConfig = { bubbles: true, cancelable: true, keyCode: 13, key: 'Enter' };
    inputElement.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
    inputElement.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
}

function updateLog(text, type) {
    const logArea = document.getElementById('aa-log-area');
    if (!logArea) return;
    const div = document.createElement('div');
    div.innerText = text;
    div.style.cssText = type === "APPEND" 
        ? "color: #a3be8c; margin-bottom: 4px; font-size: 12px;"
        : "color: #888; border-bottom: 1px solid #444; margin: 8px 0; padding-bottom: 2px;";
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

// --- TARGET LOGIC ---

function initTarget() {
  enableInputGuard(); 
  createInterface(false); // false = no input box for target

  setTimeout(() => {
      const map = Heuristics.generateMap();
      targetMap = map;
      const contentNode = Heuristics.findMainContent();
      
      const toolSchema = map.map(item => `ID: "${item.id}" | Type: ${item.tag} | Text: "${item.text}"`).join('\n');
      const fullReport = `TARGET: ${document.title}\nURL: ${window.location.href}\nELEMENTS:\n${toolSchema}\nCONTENT:\n${contentNode.innerText.substring(0, 5000)}`;
      
      chrome.runtime.sendMessage({
        action: "TARGET_UPDATE",
        payload: { type: "FULL", content: fullReport, url: window.location.href }
      });

  }, 1000);
}

function executeCommand(cmd) {
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.style.outline = "3px solid #a3be8c"; 
            setTimeout(() => {
                if (cmd.action === "click") el.click();
                if (cmd.action === "type") {
                    el.value = cmd.value;
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                }
                el.style.outline = "";
                chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `OK: ${cmd.action} -> ${cmd.id}` }
                });
            }, 600);
        } else {
             chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `ERROR: Element ${cmd.id} not found` }
            });
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        chrome.runtime.sendMessage({
            action: "TARGET_UPDATE",
            payload: { type: "APPEND", content: `Search '${cmd.value}': ${found ? "FOUND" : "NO RESULT"}` }
        });
    }
}
