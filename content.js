let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- REAL-TIME STATE ---
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
          showToast("⚠️ REMOTE COMMAND RECEIVED", "#e0e0e0");
          handleRemoteCommand(msg.payload);
      }
      break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// --- UI: TOAST NOTIFICATIONS ---
let toastEl = null;
function showToast(text, bgColor = "#252525", pulse = false) {
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = `
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px; color: #fff; font-family: sans-serif; font-size: 14px; font-weight: bold;
            border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 2147483647;
            border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s; pointer-events: none;
        `;
        document.body.appendChild(toastEl);
    }
    toastEl.innerText = text;
    toastEl.style.background = bgColor;
    
    if (pulse) {
        toastEl.style.animation = "aa-pulse 1.5s infinite";
        if (!document.getElementById('aa-styles')) {
            const style = document.createElement('style');
            style.id = 'aa-styles';
            style.innerHTML = `@keyframes aa-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(255,255,255, 0); } 100% { box-shadow: 0 0 0 0 rgba(255,255,255, 0); } }`;
            document.head.appendChild(style);
        }
    } else {
        toastEl.style.animation = "none";
    }
}

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
    
    window.addEventListener('focus', (e) => {
        const target = e.target;
        if (target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            activeInput = target;
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
        
        // Only block if we are actually in a text box
        if (target && target.matches && target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            console.log("[System] Enter Blocked");
            e.preventDefault();
            e.stopPropagation();
            showToast("⛔ ENTER DISABLED. PLEASE CLICK 'SEND'.", "#bf616a", true);
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    // Use composedPath to pierce Shadow DOM (e.g. clicking SVG inside button)
    const path = e.composedPath();
    
    // Find the first button-like ancestor
    const btn = path.find(el => {
        return el.tagName && (
            el.matches('button, [role="button"], input[type="submit"]') ||
            el.getAttribute('data-testid')?.includes('send') ||
            el.getAttribute('aria-label')?.includes('send')
        );
    });
    
    if (btn) {
        // Check if we have a draft
        if (activeInput && (activeInput.value || activeInput.innerText)) {
            console.log("[System] TRAPPED CLICK on:", btn);
            
            // STOP THE CLICK
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Capture State
            draftText = activeInput.value || activeInput.innerText || "";
            
            // Execute
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

// --- OUTPUT PARSING ---
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
