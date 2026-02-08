let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- REAL-TIME STATE ---
let draftText = "";
let activeInput = null;

// --- SHADOW DOM SETUP ---
let shadowHost = null;
let shadowRoot = null;
let toastEl = null;

function ensureShadowDOM() {
    if (shadowHost) return;

    // Create Host
    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-shadow-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    
    // Attach to HTML to avoid Body-level overlays hiding it
    (document.documentElement || document.body).appendChild(shadowHost);

    // Create Shadow Root
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    // Inject Styles ONCE
    const style = document.createElement('style');
    style.textContent = `
        .aa-toast {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 14px; font-weight: 600; background: #252525;
            border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
            border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s; pointer-events: none;
            display: flex; align-items: center; gap: 8px; opacity: 0;
        }
        .aa-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        .aa-pulse { animation: pulse 1.5s infinite; }
        @keyframes pulse { 
            0% { box-shadow: 0 0 0 0 rgba(255,255,255, 0.2); } 
            70% { box-shadow: 0 0 0 10px rgba(255,255,255, 0); } 
            100% { box-shadow: 0 0 0 0 rgba(255,255,255, 0); } 
        }
    `;
    shadowRoot.appendChild(style);

    // Create Toast Container
    toastEl = document.createElement('div');
    toastEl.className = 'aa-toast';
    shadowRoot.appendChild(toastEl);
}

function showToast(text, bgColor = "#252525", pulse = false) {
    ensureShadowDOM();
    if (!toastEl) return;

    toastEl.innerText = text;
    toastEl.style.background = bgColor;
    
    // Toggle Classes
    toastEl.classList.add('visible');
    if (pulse) toastEl.classList.add('aa-pulse');
    else toastEl.classList.remove('aa-pulse');
}

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
          showToast("⚠️ REMOTE COMMAND RECEIVED", "#e0e0e0");
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
  showToast("1. TYPE YOUR PROMPT...", "#2e3440");
  
  startInputMonitor();
  armAgentTrap();
  observeAgentOutput();
}

// 1. INPUT MONITOR
function startInputMonitor() {
    const updateState = (target) => {
        activeInput = target;
        draftText = target.value || target.innerText || "";
        
        if (draftText.length > 0) {
            showToast("2. CLICK 'SEND' BUTTON (Do not use Enter)", "#bf616a", true);
        } else {
            showToast("1. TYPE YOUR PROMPT...", "#2e3440");
        }
    };

    window.addEventListener('input', (e) => {
        if (!e.isTrusted) return;
        const target = e.target;
        if (target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            updateState(target);
        }
    }, true);
    
    // Also check on focus to remind user
    window.addEventListener('focus', (e) => {
        const target = e.target;
        if (target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            activeInput = target;
            if ((target.value || target.innerText || "").length > 0) {
                showToast("2. CLICK 'SEND' BUTTON (Do not use Enter)", "#bf616a", true);
            }
        }
    }, true);
}

// 2. THE TRAP
function armAgentTrap() {
    window.addEventListener('keydown', handleKeyBlockade, true);
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;
    
    if (e.key === 'Enter') {
        let target = e.target;
        if (target.nodeType === 3) target = target.parentElement;
        
        if (target && target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            console.log("[System] Enter Blocked");
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showToast("⛔ ENTER DISABLED. PLEASE CLICK 'SEND'.", "#bf616a", true);
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    // Use composedPath to pierce Shadow DOM
    const path = e.composedPath();
    const btn = path.find(el => {
        return el.tagName && (
            el.matches('button, [role="button"], input[type="submit"]') ||
            el.getAttribute('data-testid')?.includes('send') ||
            el.getAttribute('aria-label')?.includes('send')
        );
    });
    
    if (btn) {
        if (activeInput && (activeInput.value || activeInput.innerText)) {
            console.log("[System] TRAPPED CLICK on:", btn);
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            draftText = activeInput.value || activeInput.innerText || "";
            
            showToast("🔒 CAPTURED. INJECTING...", "#a3be8c");
            executeInjectionSequence(activeInput, btn, draftText);
        }
    }
}

// 3. EXECUTION ENGINE
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    // A. PREP
    window.removeEventListener('keydown', handleKeyBlockade, true);
    window.removeEventListener('mousedown', handleMouseTrap, true);
    enableInputGuard(); 

    // B. FETCH CONTEXT
    const response = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    const targetData = response || { content: "NO TARGET CONNECTED", url: "N/A" };
    const storage = await chrome.storage.sync.get({ universalContext: '' });
    const universal = storage.universalContext ? `\n\n[CONTEXT]:\n${storage.universalContext}` : "";

    // C. PAYLOAD
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
    showToast("🚀 LAUNCHING AGENT...", "#88c0d0");
    
    setTimeout(() => {
        let sent = false;

        // 1. Trapped Button
        if (buttonElement && buttonElement.isConnected) {
            triggerNuclearClick(buttonElement);
            sent = true;
        }

        // 2. Heuristic Button
        if (!sent) {
            const freshBtn = Heuristics.findSendButton();
            if (freshBtn) {
                triggerNuclearClick(freshBtn);
                sent = true;
            }
        }

        // 3. Enter Key Fallback
        if (!sent) {
            const keyConfig = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
        }
    }, 500);
}

// --- SIDECAR (Popup) ---
function handleRemoteCommand(text) {
    let input = activeInput;
    if (!input || !input.isConnected) input = Heuristics.findBestInput();
    
    if (input) {
        executeInjectionSequence(input, null, text);
    } else {
        showToast("❌ ERROR: CANNOT FIND INPUT", "#bf616a");
    }
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
    const blockEvent = (e) => { if (!e.isTrusted) return; e.stopPropagation(); e.preventDefault(); };
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'focus'].forEach(evt => {
        window.addEventListener(evt, blockEvent, true); 
    });
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
    showToast(`⚙️ EXEC: ${json.action}`, "#4c566a");
  }
}

// --- TARGET LOGIC ---
function initTarget() {
  showToast("🎯 TARGET LINKED", "#a3be8c");
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
