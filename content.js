// Run immediately to capture early events
console.log("[AgentAnything] Content Script Loaded at document_start");

let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- REAL-TIME STATE ---
let draftText = "";
let activeInput = null;

// --- SHADOW DOM TOAST (The HUD) ---
let shadowHost = null;
let shadowRoot = null;
let toastEl = null;

function ensureShadowDOM() {
    if (document.getElementById('aa-shadow-host')) return;
    if (!document.body && !document.documentElement) return; // Too early

    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-shadow-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    
    (document.documentElement || document.body).appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        .aa-toast {
            position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%);
            padding: 14px 28px; color: #fff; font-family: sans-serif; 
            font-size: 16px; font-weight: 700; background: #252525;
            border-radius: 50px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); 
            border: 2px solid rgba(255,255,255,0.1); opacity: 0; transition: opacity 0.3s;
            pointer-events: none; text-align: center; white-space: nowrap;
        }
        .aa-toast.visible { opacity: 1; }
        .aa-green { border-color: #a3be8c; color: #a3be8c; }
        .aa-red { border-color: #bf616a; color: #bf616a; }
    `;
    shadowRoot.appendChild(style);

    toastEl = document.createElement('div');
    toastEl.className = 'aa-toast';
    shadowRoot.appendChild(toastEl);
}

function showToast(text, type = "normal") {
    ensureShadowDOM();
    if (!toastEl) return;
    toastEl.innerText = text;
    toastEl.className = 'aa-toast visible';
    if (type === "success") toastEl.classList.add('aa-green');
    if (type === "error") toastEl.classList.add('aa-red');
}

// --- MESSAGING ---
// We wrap in a try/catch because sendMessage might fail before background is ready
try {
    chrome.runtime.sendMessage({ action: "HELLO" });
} catch(e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        // Wait for DOM to be ready for visual stuff
        if (document.readyState === "loading") {
            document.addEventListener('DOMContentLoaded', initAgent);
        } else {
            initAgent();
        }
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
          showToast("⚠️ REMOTE COMMAND RECEIVED");
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
  showToast("1. TYPE PROMPT  |  2. CLICK SEND");
  
  // Start the visual lock loop
  setInterval(highlightActiveInput, 1000);
  
  startInputMonitor();
  armAgentTrap();
  observeAgentOutput();
}

// 1. VISUAL HIGHLIGHTER (The "Lock")
function highlightActiveInput() {
    // Try to find the input we should be watching
    let input = activeInput;
    if (!input || !input.isConnected) {
        input = Heuristics.findBestInput();
    }
    
    if (input && input !== activeInput) {
        // Remove old border if different
        if (activeInput) activeInput.style.outline = "";
        activeInput = input;
    }

    if (activeInput) {
        // Apply Neon Green Border to confirm Lock
        activeInput.style.outline = "2px solid #a3be8c";
        activeInput.setAttribute("data-aa-locked", "true");
    }
}

// 2. INPUT MONITOR
function startInputMonitor() {
    window.addEventListener('input', (e) => {
        if (!e.isTrusted) return;
        const target = e.target;
        if (isInput(target)) {
            draftText = target.value || target.innerText || "";
            if (draftText.length > 0) showToast("CLICK 'SEND' TO LAUNCH", "normal");
        }
    }, true);
}

function isInput(el) {
    if (!el) return false;
    return el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

// 3. THE TRAP
function armAgentTrap() {
    // Capture Phase: Window -> Target
    window.addEventListener('keydown', handleKeyBlockade, true);
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Enter') {
        let target = e.target;
        if (target.nodeType === 3) target = target.parentElement; // Text Node fix
        
        if (isInput(target)) {
            // BLOCK ENTER
            console.log("[System] Enter Key Blocked");
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showToast("⛔ ENTER DISABLED. CLICK SEND.", "error");
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    // Use composedPath for Shadow DOM support
    const path = e.composedPath();
    const btn = path.find(el => {
        return el.tagName && (
            el.matches('button, [role="button"], input[type="submit"]') ||
            el.getAttribute('data-testid')?.includes('send') ||
            el.getAttribute('aria-label')?.includes('send')
        );
    });

    if (btn) {
        // Only trap if we have a draft and an active input
        if (activeInput && (activeInput.value || activeInput.innerText)) {
            console.log("[System] TRAPPED CLICK on:", btn);
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            draftText = activeInput.value || activeInput.innerText || "";
            
            showToast("🔒 INJECTING...", "success");
            executeInjectionSequence(activeInput, btn, draftText);
        }
    }
}

// 4. EXECUTION
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    // A. PREP
    window.removeEventListener('keydown', handleKeyBlockade, true);
    window.removeEventListener('mousedown', handleMouseTrap, true);
    enableInputGuard(); 

    // B. FETCH
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

    // E. SUBMIT
    showToast("🚀 LAUNCHING...", "success");
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

        // 3. Fallback Enter
        if (!sent) {
            const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', k));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', k));
        }
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

// --- SIDECAR ---
function handleRemoteCommand(text) {
    let input = activeInput || Heuristics.findBestInput();
    if (input) executeInjectionSequence(input, null, text);
    else showToast("❌ ERROR: NO INPUT FOUND", "error");
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
    showToast(`EXEC: ${json.action}`, "normal");
  }
}

// --- TARGET ---
function initTarget() {
  showToast("TARGET LINKED", "success");
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
