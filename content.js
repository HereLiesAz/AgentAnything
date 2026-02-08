console.log("[AgentAnything] Content Script Loaded");

let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- STATE ---
let draftText = "";
let activeInput = null;

// --- SHADOW DOM UI (The Immortal Panel) ---
let shadowHost = null;
let shadowRoot = null;
let panelEl = null;   // Permanent Status
let toastEl = null;   // Temporary Alerts

function ensureUI() {
    // If it exists and is on screen, we are good.
    if (shadowHost && shadowHost.isConnected) return;

    // Wait for body to be safe
    if (!document.body) return; 

    // Create Host
    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-ui-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
        /* Permanent Panel */
        .aa-panel {
            position: fixed; bottom: 20px; left: 20px;
            background: #1a1a1a; border: 1px solid #333;
            color: #e0e0e0; font-family: monospace; font-size: 12px;
            padding: 8px 12px; border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex; align-items: center; gap: 10px;
            pointer-events: auto; user-select: none;
            transition: all 0.2s;
        }
        .aa-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; }
        .aa-dot.green { background: #a3be8c; box-shadow: 0 0 5px #a3be8c; }
        .aa-dot.red { background: #bf616a; box-shadow: 0 0 5px #bf616a; }
        .aa-dot.blue { background: #88c0d0; box-shadow: 0 0 5px #88c0d0; }

        /* Temporary Toasts */
        .aa-toast {
            position: fixed; bottom: 60px; left: 20px;
            background: rgba(46, 52, 64, 0.9); color: #fff;
            padding: 8px 16px; border-radius: 4px; font-family: sans-serif; font-size: 13px;
            opacity: 0; transform: translateY(10px); transition: all 0.3s;
            border-left: 3px solid #88c0d0;
        }
        .aa-toast.visible { opacity: 1; transform: translateY(0); }
    `;
    shadowRoot.appendChild(style);

    // Build Panel
    panelEl = document.createElement('div');
    panelEl.className = 'aa-panel';
    panelEl.innerHTML = `
        <div class="aa-dot" id="aa-status-dot"></div>
        <span id="aa-status-text">AGENTANYTHING: READY</span>
    `;
    shadowRoot.appendChild(panelEl);

    // Build Toast Container
    toastEl = document.createElement('div');
    toastEl.className = 'aa-toast';
    shadowRoot.appendChild(toastEl);
}

// --- UI UPDATERS ---

function setStatus(text, color = "gray") {
    ensureUI();
    if (!panelEl) return;
    
    const dot = shadowRoot.getElementById('aa-status-dot');
    const label = shadowRoot.getElementById('aa-status-text');
    
    label.innerText = text;
    dot.className = "aa-dot " + color; // green, red, blue, gray
}

function showToast(text) {
    ensureUI();
    if (!toastEl) return;
    
    toastEl.innerText = text;
    toastEl.classList.add('visible');
    
    // Auto-hide
    setTimeout(() => {
        if(toastEl) toastEl.classList.remove('visible');
    }, 3000);
}

// --- IMMORTALITY LOOP ---
// If the page wipes our UI, put it back.
setInterval(() => {
    if (role && (!shadowHost || !shadowHost.isConnected)) {
        ensureUI();
        // Restore last known state if needed (simplified here)
        if (role === "AGENT") setStatus("AGENT: MONITORING INPUT", "blue");
        if (role === "TARGET") setStatus("TARGET: LINKED", "green");
    }
    
    // Also keep visual lock on input
    if (role === "AGENT") highlightActiveInput();
}, 1000);


// --- MESSAGING ---
try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        // Ensure DOM is ready
        if (document.body) initAgent();
        else window.addEventListener('DOMContentLoaded', initAgent);
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        if (document.body) initTarget();
        else window.addEventListener('DOMContentLoaded', initTarget);
      }
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "REMOTE_INJECT":
      if (role === "AGENT") {
          showToast("REMOTE COMMAND RECEIVED");
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
  console.log("[System] Agent Armed.");
  setStatus("AGENT: MONITORING INPUT", "blue");
  
  startInputMonitor();
  armAgentTrap();
  observeAgentOutput();
}

function highlightActiveInput() {
    // Refresh active input
    let input = activeInput;
    if (!input || !input.isConnected) input = Heuristics.findBestInput();
    
    if (input) {
        input.style.outline = "2px solid #a3be8c";
        input.setAttribute('data-aa-lock', 'true');
    }
}

// 1. MONITOR
function startInputMonitor() {
    window.addEventListener('input', (e) => {
        if (!e.isTrusted) return;
        const target = e.target;
        if (isInput(target)) {
            activeInput = target;
            draftText = target.value || target.innerText || "";
            
            if (draftText.length > 0) {
                setStatus("READY. CLICK 'SEND' TO ARM.", "green");
            } else {
                setStatus("AGENT: MONITORING INPUT", "blue");
            }
        }
    }, true);
    
    window.addEventListener('focus', (e) => {
        const target = e.target;
        if (isInput(target)) activeInput = target;
    }, true);
}

function isInput(el) {
    return el && el.matches && el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

// 2. TRAP
function armAgentTrap() {
    window.addEventListener('keydown', handleKeyBlockade, true);
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Enter') {
        const target = e.composedPath()[0]; // Shadow DOM safe
        // Handle text nodes
        const el = (target.nodeType === 3) ? target.parentElement : target;
        
        if (isInput(el)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showToast("⛔ ENTER DISABLED. CLICK SEND.");
            setStatus("WAITING FOR CLICK...", "red");
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    const path = e.composedPath();
    const btn = path.find(el => el.tagName && (
        el.matches('button, [role="button"], input[type="submit"]') ||
        el.getAttribute('data-testid')?.includes('send') ||
        el.getAttribute('aria-label')?.includes('send')
    ));

    if (btn && activeInput && (activeInput.value || activeInput.innerText)) {
        console.log("[System] TRAPPED CLICK");
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        draftText = activeInput.value || activeInput.innerText || "";
        
        setStatus("LOCKED. INJECTING...", "green");
        executeInjectionSequence(activeInput, btn, draftText);
    }
}

// 3. EXECUTE
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    window.removeEventListener('keydown', handleKeyBlockade, true);
    window.removeEventListener('mousedown', handleMouseTrap, true);
    enableInputGuard(); 

    // Fetch Context
    const response = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    const targetData = response || { content: "NO TARGET CONNECTED", url: "N/A" };
    const storage = await chrome.storage.sync.get({ universalContext: '' });
    const universal = storage.universalContext ? `\n\n[CONTEXT]:\n${storage.universalContext}` : "";

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

    // Inject
    setNativeValue(inputElement, ""); 
    await visualType(inputElement, finalPayload);

    // Submit
    setStatus("SENDING...", "blue");
    
    setTimeout(() => {
        let sent = false;
        
        if (buttonElement && buttonElement.isConnected) {
            triggerNuclearClick(buttonElement);
            sent = true;
        }

        if (!sent) {
            const freshBtn = Heuristics.findSendButton();
            if (freshBtn) {
                triggerNuclearClick(freshBtn);
                sent = true;
            }
        }

        if (!sent) {
            // Enter key fallback
            const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', k));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', k));
        }
        
        showToast("SENT!");
    }, 500);
}

// --- UTILS ---
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
    if (valueSetter && valueSetter !== prototypeValueSetter) prototypeValueSetter.call(element, value);
    else if (valueSetter) valueSetter.call(element, value);
    else { element.value = value; element.innerText = value; }
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

async function visualType(input, text) {
    setNativeValue(input, text);
    ['beforeinput', 'input', 'change'].forEach(evt => input.dispatchEvent(new Event(evt, { bubbles: true })));
}

function enableInputGuard() {
    if (inputGuardActive) return;
    inputGuardActive = true;
    const block = (e) => { if (!e.isTrusted) return; e.stopPropagation(); e.preventDefault(); };
    ['click', 'mousedown', 'keydown'].forEach(evt => window.addEventListener(evt, block, true));
}

function handleRemoteCommand(text) {
    let input = activeInput || Heuristics.findBestInput();
    if (input) executeInjectionSequence(input, null, text);
    else showToast("ERROR: NO INPUT FOUND");
}

// --- PARSER ---
function observeAgentOutput() {
  const observer = new MutationObserver((mutations) => {
    const bodyText = document.body.innerText;
    if (bodyText.match(/```/)) parseCommands(bodyText);
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
    } catch (e) {}
  }
}

function sanitizeJson(str) {
  return str.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
}

function dispatchIfNew(json) {
  const sig = JSON.stringify(json);
  if (sig !== lastCommandSignature) {
    lastCommandSignature = sig;
    chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: { ...json, targetTabId: window.activeTargetId } });
    setStatus(`RUNNING: ${json.action}`, "green");
  }
}

// --- TARGET ---
function initTarget() {
  setStatus("TARGET LINKED", "green");
  setTimeout(() => {
      const map = Heuristics.generateMap();
      const content = Heuristics.findMainContent().innerText.substring(0, 5000);
      const report = `ELEMENTS:\n${map.map(i => `ID: "${i.id}" | ${i.tag} | "${i.text}"`).join('\n')}\nCONTENT:\n${content}`;
      chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "FULL", content: report, url: window.location.href } });
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
                if (cmd.action === "type") setNativeValue(el, cmd.value);
                el.style.outline = "";
                chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "APPEND", content: `OK: ${cmd.action} -> ${cmd.id}` } });
            }, 500);
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "APPEND", content: `Search '${cmd.value}': ${found ? "FOUND" : "NO RESULT"}` } });
    }
}
