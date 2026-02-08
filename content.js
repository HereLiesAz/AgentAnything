console.log("[AgentAnything] Content Script Loaded");

let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- STATE ---
let draftText = ""; // The Passive Monitor cache
let activeInput = null;

// --- SHADOW DOM UI (The Immortal Panel) ---
let shadowHost = null;
let shadowRoot = null;
let panelEl = null;   
let toastEl = null;   

function ensureUI() {
    // 1. Existence Check
    const existingHost = document.getElementById('aa-ui-host');
    if (existingHost && existingHost.shadowRoot) {
        shadowHost = existingHost;
        shadowRoot = existingHost.shadowRoot;
        panelEl = shadowRoot.getElementById('aa-panel-inner');
        toastEl = shadowRoot.getElementById('aa-toast-inner');
        if (panelEl && toastEl) return; // UI is healthy
    }

    // 2. Destruction & Rebuild
    if (existingHost) existingHost.remove();

    if (!document.body) return; // Too early

    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-ui-host';
    // Max Z-Index, fixed, ignored by pointer events unless hitting the panel
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
    
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        .aa-panel {
            position: fixed; bottom: 20px; left: 20px;
            background: #1a1a1a; border: 1px solid #333;
            color: #e0e0e0; font-family: monospace; font-size: 12px;
            padding: 8px 12px; border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
            display: flex; align-items: center; gap: 10px;
            pointer-events: auto; user-select: none;
            transition: all 0.2s;
            z-index: 2147483647;
        }
        .aa-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; }
        .aa-dot.green { background: #a3be8c; box-shadow: 0 0 5px #a3be8c; }
        .aa-dot.red { background: #bf616a; box-shadow: 0 0 5px #bf616a; }
        .aa-dot.blue { background: #88c0d0; box-shadow: 0 0 5px #88c0d0; }
        .aa-dot.yellow { background: #ebcb8b; box-shadow: 0 0 5px #ebcb8b; }

        .aa-toast {
            position: fixed; bottom: 60px; left: 20px;
            background: rgba(46, 52, 64, 0.95); color: #fff;
            padding: 8px 16px; border-radius: 4px; font-family: sans-serif; font-size: 13px;
            opacity: 0; transform: translateY(10px); transition: all 0.3s;
            border-left: 3px solid #88c0d0;
            pointer-events: none;
        }
        .aa-toast.visible { opacity: 1; transform: translateY(0); }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.id = 'aa-panel-inner';
    panelEl.className = 'aa-panel';
    panelEl.innerHTML = `
        <div class="aa-dot" id="aa-status-dot"></div>
        <span id="aa-status-text">SYSTEM: STANDBY</span>
    `;
    shadowRoot.appendChild(panelEl);

    toastEl = document.createElement('div');
    toastEl.id = 'aa-toast-inner';
    toastEl.className = 'aa-toast';
    shadowRoot.appendChild(toastEl);
}

// --- UI UPDATERS ---
function setStatus(text, color = "gray") {
    ensureUI();
    if (!panelEl) return;
    
    const dot = shadowRoot.getElementById('aa-status-dot');
    const label = shadowRoot.getElementById('aa-status-text');
    
    if(label) label.innerText = text;
    if(dot) dot.className = "aa-dot " + color;
}

function showToast(text) {
    ensureUI();
    if (!toastEl) return;
    
    toastEl.innerText = text;
    toastEl.classList.add('visible');
    
    setTimeout(() => {
        if(toastEl) toastEl.classList.remove('visible');
    }, 4000);
}

// --- IMMORTALITY LOOP ---
setInterval(() => {
    if (role && (!shadowHost || !shadowHost.isConnected)) {
        ensureUI();
        if (role === "AGENT") setStatus("AGENT: ARMED", "blue");
        if (role === "TARGET") setStatus("TARGET: LINKED", "green");
    }
    
    // Maintain Input Lock Visuals
    if (role === "AGENT" && activeInput && activeInput.isConnected) {
        if (activeInput.style.outline !== "2px solid #a3be8c") {
             activeInput.style.outline = "2px solid #a3be8c";
        }
    } else if (role === "AGENT") {
        // Lost the input? find it again.
        activeInput = Heuristics.findBestInput();
    }
}, 800);


// --- MESSAGING ---
try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        // Ensure DOM is ready or wait
        if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initAgent);
        else initAgent();
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initTarget);
        else initTarget();
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
    case "INJECT_UPDATE":
        if (role === "AGENT") {
            // Optional: Show feedback in agent UI if needed
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
  setStatus("AGENT: ARMED", "blue");
  
  startPassiveInputMonitor(); // The Draft Engine
  armAgentTrap();             // The Capture Trap
  observeAgentOutput();       // The Parser
}

// 1. DRAFT ENGINE (Passive Monitor)
function startPassiveInputMonitor() {
    // Listen to everything, bubble phase is fine for reading
    window.addEventListener('input', (e) => {
        const target = e.target;
        if (isInput(target)) {
            activeInput = target;
            draftText = target.value || target.innerText || "";
            
            // Highlight
            target.style.outline = "2px solid #a3be8c";
        }
    }, true);
    
    window.addEventListener('focus', (e) => {
        if (isInput(e.target)) activeInput = e.target;
    }, true);
}

function isInput(el) {
    return el && el.matches && el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

// 2. CAPTURE PHASE TRAP
function armAgentTrap() {
    // CAPTURE PHASE: TRUE. We get the event before React/Angular/Vue.
    window.addEventListener('keydown', handleKeyBlockade, true);
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Enter' && !e.shiftKey) { // Allow Shift+Enter for new lines
        const target = e.composedPath()[0]; // Shadow DOM safe
        const el = (target.nodeType === 3) ? target.parentElement : target;
        
        if (isInput(el)) {
            // Update draft one last time
            draftText = el.value || el.innerText || draftText;

            if (!draftText || draftText.trim() === "") return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            setStatus("INTERCEPTED: ENTER", "yellow");
            executeInjectionSequence(el, null, draftText);
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    // Check if we are clicking a send button
    const path = e.composedPath();
    const btn = path.find(el => el.tagName && (
        el.matches('button, [role="button"], input[type="submit"]') ||
        el.getAttribute('data-testid')?.includes('send') ||
        el.getAttribute('aria-label')?.includes('send')
    ));

    if (btn && activeInput && (draftText.length > 0)) {
        console.log("[System] TRAPPED CLICK");
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        setStatus("INTERCEPTED: CLICK", "yellow");
        executeInjectionSequence(activeInput, btn, draftText);
    }
}

// 3. EXECUTE & RESURRECT
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    // Temporarily disable trap to prevent loops? No, we just won't trigger it ourselves.
    // Actually we need to remove the trap listeners or guard against our own dispatch?
    // We will use inputGuardActive to prevent re-entry if needed, but since we are doing
    // programmatic dispatch, isTrusted will be false, so the trap ignores it. Perfect.

    // enableInputGuard(); // Block user interference during injection

    // Fetch Context
    let targetData;
    try {
        targetData = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    } catch (err) {
        targetData = null;
    }
    
    if (!targetData) {
        targetData = { content: "NO TARGET CONNECTED. TELL USER TO CONNECT TARGET.", url: "N/A" };
        showToast("⚠️ NO TARGET CONNECTED");
    }

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

    setStatus("INJECTING PAYLOAD...", "blue");

    // REACT NATIVE VALUE SETTER HACK
    // Simply setting .value fails on React 16+. We must get the prototype setter.
    setNativeValue(inputElement, finalPayload);
    
    // Dispatch events to wake up the framework
    ['focus', 'input', 'change'].forEach(evt => 
        inputElement.dispatchEvent(new Event(evt, { bubbles: true }))
    );

    // Wait for UI to update
    setTimeout(() => {
        setStatus("FIRING...", "red");
        
        // RESURRECTION CLICKER
        // 1. Try original button
        let sent = false;
        if (buttonElement && buttonElement.isConnected) {
            triggerNuclearClick(buttonElement);
            sent = true;
        }

        // 2. Try to find a fresh button (Resurrection)
        if (!sent) {
            console.log("[Resurrection] Looking for fresh send button...");
            const freshBtn = Heuristics.findSendButton();
            if (freshBtn) {
                triggerNuclearClick(freshBtn);
                sent = true;
            }
        }

        // 3. Fallback: Enter Key
        if (!sent) {
            console.log("[Fallback] Dispatching Enter Key...");
            const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', k));
            inputElement.dispatchEvent(new KeyboardEvent('keypress', k)); // Deprecated but sometimes needed
            inputElement.dispatchEvent(new KeyboardEvent('keyup', k));
        }
        
        showToast("🚀 PAYLOAD SENT");
        setStatus("AGENT: LISTENING", "blue");
        
        // Clear draft
        draftText = "";
    }, 200);
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
    
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
        element.innerText = value;
    }
    
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function handleRemoteCommand(text) {
    let input = activeInput || Heuristics.findBestInput();
    if (input) executeInjectionSequence(input, null, text);
    else showToast("ERROR: NO INPUT FOUND");
}

// --- PARSER ---
function observeAgentOutput() {
  const observer = new MutationObserver((mutations) => {
    // Only parse if we are Agent
    if (role !== "AGENT") return;

    // Throttle? No, we want speed.
    // But we need to avoid reparsing the same block.
    // Using simple regex on the whole body is inefficient but robust against DOM changes.
    const bodyText = document.body.innerText;
    if (bodyText.includes("```json") || bodyText.includes("```")) {
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
      const jsonStr = sanitizeJson(match[1]);
      const json = JSON.parse(jsonStr);
      dispatchIfNew(json);
    } catch (e) {
        // console.warn("JSON Parse Fail", e);
    }
  }
}

function sanitizeJson(str) {
  return str
    .replace(/\/\/.*$/gm, '') // Remove comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, '}') // Trailing commas
    .replace(/,\s*]/g, ']');
}

function dispatchIfNew(json) {
  const sig = JSON.stringify(json);
  if (sig !== lastCommandSignature) {
    lastCommandSignature = sig;
    chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: { ...json, targetTabId: window.activeTargetId } });
    setStatus(`RUNNING: ${json.action}`, "green");
    showToast(`CMD: ${json.action}`);
  }
}

// --- TARGET ---
function initTarget() {
  setStatus("TARGET LINKED", "green");
  
  // Initial Report
  reportTargetState();

  // Periodic diff check (slow poll to save perf)
  setInterval(reportTargetState, 2000);
}

function reportTargetState() {
    const map = Heuristics.generateMap();
    const mainContent = Heuristics.findMainContent().innerText.substring(0, 5000);
    const report = `ELEMENTS:\n${map.map(i => `ID: "${i.id}" | ${i.tag} | "${i.text}"`).join('\n')}\nCONTENT:\n${mainContent}`;
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "FULL", content: report, url: window.location.href } });
}

function executeCommand(cmd) {
    showToast(`EXEC: ${cmd.action}`);
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.style.outline = "3px solid #0f0";
            
            setTimeout(() => {
                if (cmd.action === "click") {
                    el.click();
                    // Also try event dispatch
                    triggerNuclearClick(el);
                }
                if (cmd.action === "type") setNativeValue(el, cmd.value);
                
                el.style.outline = "";
                
                // Immediate update
                setTimeout(reportTargetState, 1000);
            }, 500);
        } else {
            showToast(`ERROR: ID ${cmd.id} NOT FOUND`);
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        showToast(`FIND: ${cmd.value} -> ${found}`);
    }
}
