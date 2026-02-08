let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- REAL-TIME CACHE ---
let draftText = "";
let activeInput = null;

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
    case "REMOTE_INJECT":
      if (role === "AGENT") {
          console.log("[System] Received Remote Command");
          handleRemoteCommand(msg.payload);
      }
      break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// --- AGENT LOGIC ---

function initAgent() {
  console.log("[System] Agent Armed. Monitor Active.");
  showStatusBadge("AGENT ARMED: Type & CLICK SEND");
  
  startInputMonitor();
  armAgentTrap();
  observeAgentOutput();
}

// 1. INPUT MONITOR (Passive)
function startInputMonitor() {
    window.addEventListener('input', (e) => {
        if (!e.isTrusted) return;

        const target = e.target;
        if (target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            activeInput = target;
            draftText = target.value || target.innerText || "";
        }
    }, true);
    
    window.addEventListener('focus', (e) => {
        const target = e.target;
        if (target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            activeInput = target;
        }
    }, true);
}

// 2. THE TRAP (Aggressive)
function armAgentTrap() {
    // We intercept Keydown to BLOCK Enter
    window.addEventListener('keydown', handleKeyBlockade, true);
    // We intercept Mousedown to TRAP Clicks
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;

    if (e.key === 'Enter') {
        let target = e.target;
        if (target.nodeType === 3) target = target.parentElement;
        
        if (target && target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            // STOP EVERYTHING
            console.log("[System] Enter Key Blocked. Waiting for Click.");
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Visual Warning
            showStatusBadge("⚠️ DO NOT USE ENTER! CLICK THE 'SEND' BUTTON.");
            
            // Flash the badge red
            const badge = document.getElementById('aa-status-badge');
            if (badge) {
                badge.style.backgroundColor = "#bf616a";
                setTimeout(() => badge.style.backgroundColor = "#252525", 1000);
            }
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    let target = e.target;
    if (target.nodeType === 3) target = target.parentElement;
    if (!target || typeof target.closest !== 'function') return;

    // Check for button-like elements
    const btn = target.closest('button, [role="button"], input[type="submit"], [data-testid*="send"], svg');
    
    if (btn) {
        // Do we have a draft?
        if (activeInput && (activeInput.value || activeInput.innerText)) {
            console.log("[System] Trap Triggered by MOUSEDOWN on", btn);
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Sync final state
            draftText = activeInput.value || activeInput.innerText || "";
            
            executeInjectionSequence(activeInput, btn, draftText);
        }
    }
}

// 2. THE SIDECAR (Popup Interaction)
function handleRemoteCommand(text) {
    let input = activeInput;
    if (!input || !input.isConnected) {
        input = Heuristics.findBestInput();
    }
    
    if (input) {
        executeInjectionSequence(input, null, text);
    } else {
        console.error("AgentAnything: Could not find input box for remote command.");
        showStatusBadge("ERROR: Chat Input Not Found");
    }
}

// 3. THE EXECUTION ENGINE
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    // A. LOCK DOWN
    window.removeEventListener('keydown', handleKeyBlockade, true);
    window.removeEventListener('mousedown', handleMouseTrap, true);
    enableInputGuard(); 
    showStatusBadge("PREPARING PAYLOAD...");

    // B. FETCH CONTEXT
    const response = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    const targetData = response || { content: "NO TARGET CONNECTED", url: "N/A" };
    const storage = await chrome.storage.sync.get({ universalContext: '' });
    const universal = storage.universalContext ? `\n\n[CONTEXT]:\n${storage.universalContext}` : "";

    // C. BUILD PAYLOAD
    const finalPayload = `
[SYSTEM: AGENT ROLE ACTIVE]
[PROTOCOL: JSON OUTPUT ONLY]

1. INTERACTION TOOL:
\`\`\`json
{ "tool": "interact", "id": "ELEMENT_ID", "action": "click" | "type" | "read", "value": "text" }
\`\`\`

2. BROWSER TOOL:
\`\`\`json
{ "tool": "browser", "action": "refresh" | "back" | "forward" | "find", "value": "term" }
\`\`\`

[TARGET MAP]:
URL: ${targetData.url}
${targetData.content}

${universal}

[USER INSTRUCTION]:
${userText}
`;

    // D. INJECT
    setNativeValue(inputElement, ""); 
    await visualType(inputElement, finalPayload);

    // E. NUCLEAR SUBMIT
    showStatusBadge("SENDING...");
    
    setTimeout(() => {
        let sent = false;

        // Attempt 1: Trigger the trapped button
        if (buttonElement && buttonElement.isConnected) {
            console.log("[System] Clicking Trapped Button");
            triggerNuclearClick(buttonElement);
            sent = true;
        }

        // Attempt 2: Fallback to Heuristic Button
        if (!sent) {
            const freshBtn = Heuristics.findSendButton();
            if (freshBtn) {
                console.log("[System] Clicking Heuristic Button");
                triggerNuclearClick(freshBtn);
                sent = true;
            }
        }

        // Attempt 3: Enter Key (Only used if no button found/worked)
        if (!sent) {
            console.log("[System] Fallback: Enter Key");
            const keyConfig = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
            if (inputElement.form) inputElement.form.requestSubmit ? inputElement.form.requestSubmit() : inputElement.form.submit();
        }
    }, 500);
}

// --- UTILITIES ---

function triggerNuclearClick(el) {
    const opts = { view: window, bubbles: true, cancelable: true, buttons: 1 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
}

function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    
    if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
        element.innerText = value;
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

async function visualType(input, text) {
    setNativeValue(input, text);
    ['beforeinput', 'input', 'change'].forEach(evt => {
        input.dispatchEvent(new Event(evt, { bubbles: true }));
    });
}

function enableInputGuard() {
    if (inputGuardActive) return;
    inputGuardActive = true;
    
    const blockEvent = (e) => {
        if (!e.isTrusted) return; 
        e.stopPropagation();
        e.preventDefault();
    };
    
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'focus'].forEach(evt => {
        window.addEventListener(evt, blockEvent, true); 
    });
}

function showStatusBadge(text) {
    let badge = document.getElementById('aa-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'aa-status-badge';
        badge.style.cssText = `
            position: fixed; bottom: 20px; left: 20px; 
            background: #252525; color: #fff; padding: 10px 15px; 
            border: 1px solid #444; border-radius: 5px;
            font-family: sans-serif; font-size: 12px; z-index: 999999;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 10px; transition: background-color 0.3s;
        `;
        document.body.appendChild(badge);
    }
    badge.innerText = text;
}

// --- OUTPUT PARSER ---
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
    try {
      const json = JSON.parse(sanitizeJson(match[1]));
      dispatchIfNew(json);
    } catch (e) { console.error(e); }
  }
}

function sanitizeJson(str) {
  return str.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
}

function dispatchIfNew(json) {
  const sig = JSON.stringify(json);
  if (sig !== lastCommandSignature) {
    lastCommandSignature = sig;
    console.log("EXECUTING:", json);
    chrome.runtime.sendMessage({ 
      action: "AGENT_COMMAND", 
      payload: { ...json, targetTabId: window.activeTargetId } 
    });
    showStatusBadge(`EXEC: ${json.action}`);
  }
}

// --- TARGET LOGIC ---
function initTarget() {
  showStatusBadge("TARGET ACTIVE");
  setTimeout(() => {
      const map = Heuristics.generateMap();
      const content = Heuristics.findMainContent().innerText.substring(0, 5000);
      const report = `ELEMENTS:\n${map.map(i => `ID: "${i.id}" | ${i.tag} | "${i.text}"`).join('\n')}\nCONTENT:\n${content}`;
      
      chrome.runtime.sendMessage({
        action: "TARGET_UPDATE",
        payload: { type: "FULL", content: report, url: window.location.href }
      });
  }, 1000);
}

function executeCommand(cmd) {
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.style.outline = "3px solid #0f0";
            setTimeout(() => {
                if (cmd.action === "click") el.click();
                if (cmd.action === "type") {
                    setNativeValue(el, cmd.value);
                }
                el.style.outline = "";
                chrome.runtime.sendMessage({
                  action: "TARGET_UPDATE",
                  payload: { type: "APPEND", content: `OK: ${cmd.action} -> ${cmd.id}` }
                });
            }, 500);
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        chrome.runtime.sendMessage({
            action: "TARGET_UPDATE",
            payload: { type: "APPEND", content: `Search '${cmd.value}': ${found ? "FOUND" : "NO RESULT"}` }
        });
    }
}
