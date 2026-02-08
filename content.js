let role = null;
let myTabId = null;
let targetMap = [];
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
  }
});

// --- UI: EVENT-BASED INPUT GUARD ---
// Blocks USER interaction, allows SCRIPT interaction.
function enableInputGuard() {
    if (inputGuardActive) return;
    inputGuardActive = true;
    
    const blockEvent = (e) => {
        // ALLOW: Events inside our own Interface Panel
        if (e.target.closest('#aa-interface')) return;

        // ALLOW: Programmatic events (Agent Actions)
        if (!e.isTrusted) return;

        // BLOCK: Real user interactions with the page
        e.stopPropagation();
        e.preventDefault();
    };
    
    // Capture events early
    const captureEvents = ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'focus', 'submit'];
    
    captureEvents.forEach(evt => {
        window.addEventListener(evt, blockEvent, true); 
    });

    const badge = document.createElement('div');
    badge.innerText = "🔒 AGENT ACTIVE";
    badge.style.cssText = `
        position: fixed; top: 10px; right: 10px; 
        background: #2e3440; color: #88c0d0; padding: 4px 8px; 
        border: 1px solid #4c566a; border-radius: 4px;
        font-family: monospace; font-size: 10px; pointer-events: none; z-index: 2147483647;
    `;
    document.body.appendChild(badge);
    
    console.log("[System] Input Guard Active. User interaction blocked.");
}

// --- AGENT INTERFACE ---

function initAgent() {
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
        
        // Activate Guard after delay
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
      
      input.onfocus = () => input.style.borderColor = "#666";
      input.onblur = () => input.style.borderColor = "#444";
      
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
      
      setTimeout(() => input.focus(), 500);
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
  
  updateLog(payload);

  let aiMessage = "";
  if (payload.type === "APPEND") {
    aiMessage = `\n[UPDATE]:\n${payload.content}`;
  } else {
    if (payload.url) {
        try {
            const hostname = new URL(payload.url).hostname.replace(/^www\./, '');
            if (!knownDomainContexts.has(hostname)) knownDomainContexts.add(hostname);
        } catch(e) {}
    }
    aiMessage = `\n[CONNECTED]:\n${payload.content}`;
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

    visualTypeAndSend(text, 0, () => {
        isProcessingQueue = false;
        setTimeout(processQueue, 1000); 
    });
}

// VISUAL TYPING ENGINE
async function visualTypeAndSend(text, retries = 0, callback) {
    const input = Heuristics.findBestInput();
    
    if (!input) {
        if (retries < 5) {
            setTimeout(() => visualTypeAndSend(text, retries + 1, callback), 1000);
            return;
        }
        if (callback) callback();
        return;
    }

    try {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        
        let currentVal = input.value || input.innerText || "";
        if (currentVal.length > 0 && !currentVal.endsWith('\n')) currentVal += "\n";
        
        let nativeSetter;
        if (input instanceof HTMLTextAreaElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        } else if (input instanceof HTMLInputElement) {
            nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        }

        for (let i = 0; i < text.length; i++) {
            currentVal += text[i];
            
            if (nativeSetter) {
                nativeSetter.call(input, currentVal);
            } else {
                input.innerText = currentVal;
            }
            
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 10)); 
        }

        // Final State Commitment
        ['beforeinput', 'input', 'change'].forEach(evt => {
            input.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
        });
        
    } catch (e) {
        console.error("Injection failed", e);
    }

    // THE NUCLEAR SUBMIT SEQUENCE
    setTimeout(() => {
        const sendBtn = Heuristics.findSendButton();
        
        // 1. Try Clicking Button
        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            // Trigger specific React/Framework listeners that might rely on mouse events
            sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        }
        
        // 2. Try Hammering Enter (Always do this as backup)
        const keyConfig = { bubbles: true, cancelable: true, keyCode: 13, key: 'Enter', code: 'Enter', which: 13 };
        input.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
        input.dispatchEvent(new KeyboardEvent('keypress', keyConfig));
        input.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
        
        // 3. Try Native Form Submit
        if (input.form) {
             if (input.form.requestSubmit) {
                 input.form.requestSubmit();
             } else {
                 input.form.submit();
             }
        }

        if (callback) callback();
    }, 500);
}

function updateLog(payload) {
    const logArea = document.getElementById('aa-log-area');
    if (!logArea) return;

    if (payload.type === "APPEND") {
        const div = document.createElement('div');
        div.innerText = payload.content;
        div.style.cssText = "color: #a3be8c; margin-bottom: 4px; font-size: 12px;";
        logArea.appendChild(div);
    } else {
        const header = document.createElement('div');
        header.style.cssText = "color: #888; border-bottom: 1px solid #444; margin: 8px 0 4px 0; padding-bottom: 2px;";
        header.innerText = `Connected: ${payload.url}`;
        logArea.appendChild(header);
    }
    logArea.scrollTop = logArea.scrollHeight;
}


// --- TARGET LOGIC ---

function initTarget() {
  enableInputGuard(); 

  const indicator = document.createElement('div');
  indicator.innerText = "LINKED";
  indicator.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; 
    background: #bf616a; color: white; padding: 4px 8px; 
    border-radius: 4px; z-index: 2147483647; 
    font-family: sans-serif; font-size: 11px; opacity: 0.8;
  `;
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

// VISUAL ACTION EXECUTION
function executeCommand(cmd) {
    if (cmd.tool === "interact") {
        // IMPORTANT: Use Heuristics to find element (Shadow DOM support)
        const el = Heuristics.getElementByAAId(cmd.id);
        
        if (el) {
            // 1. Scroll & Highlight
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            
            const originalTransition = el.style.transition;
            const originalOutline = el.style.outline;
            
            el.style.transition = "outline 0.2s";
            el.style.outline = "3px solid #a3be8c"; 
            
            // 2. Wait 500ms for user to see
            setTimeout(() => {
                if (cmd.action === "click") el.click();
                if (cmd.action === "type") {
                    el.value = cmd.value;
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                }
                
                // Cleanup Highlight
                el.style.outline = originalOutline;
                el.style.transition = originalTransition;
                
                // Report back
                chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `OK: ${cmd.action} -> ${cmd.id}` }
                });
            }, 600);
        } else {
             chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `ERROR: Element ${cmd.id} not found (DOM Changed?)` }
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
