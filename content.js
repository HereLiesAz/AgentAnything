// Run immediately to capture early events
console.log("[AgentAnything] Content Script Loaded");

let role = null;
let myTabId = null;
let lastCommandSignature = "";
let inputGuardActive = false;

// --- REAL-TIME STATE ---
let draftText = "";
let activeInput = null; // The DOM element the user is typing in

// --- SHADOW DOM HUD (The Overlay System) ---
let shadowHost = null;
let shadowRoot = null;
let toastEl = null;
let focusBoxEl = null; // The Green Border Overlay

function ensureHUD() {
    if (shadowHost && shadowHost.isConnected) return;
    if (!document.body && !document.documentElement) return; // Too early

    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-hud-host';
    // Max Z-Index, pass-through pointer events so you can still click the input under it
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
    
    (document.documentElement || document.body).appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        /* The Toast Notification */
        .aa-toast {
            position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px; color: #fff; font-family: -apple-system, system-ui, sans-serif;
            font-size: 14px; font-weight: 700; background: #1a1a1a;
            border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.8); 
            border: 1px solid rgba(255,255,255,0.1); opacity: 0; transition: opacity 0.2s;
            pointer-events: none; text-align: center; white-space: nowrap;
            display: flex; align-items: center; gap: 8px;
        }
        .aa-toast.visible { opacity: 1; }
        .aa-green { border-left: 4px solid #a3be8c; }
        .aa-red { border-left: 4px solid #bf616a; }
        
        /* The Focus Box (Green Border Overlay) */
        .aa-focus-box {
            position: absolute; border: 3px solid #a3be8c; border-radius: 4px;
            box-shadow: 0 0 15px rgba(163, 190, 140, 0.4);
            transition: all 0.1s ease-out; opacity: 0; pointer-events: none;
        }
        .aa-focus-box.visible { opacity: 1; }
        .aa-focus-label {
            position: absolute; top: -22px; right: 0; background: #a3be8c; color: #000;
            font-size: 10px; padding: 2px 6px; font-weight: bold; border-radius: 2px;
        }
    `;
    shadowRoot.appendChild(style);

    // Create Elements
    focusBoxEl = document.createElement('div');
    focusBoxEl.className = 'aa-focus-box';
    focusBoxEl.innerHTML = '<div class="aa-focus-label">AGENT TARGET</div>';
    shadowRoot.appendChild(focusBoxEl);

    toastEl = document.createElement('div');
    toastEl.className = 'aa-toast';
    shadowRoot.appendChild(toastEl);
}

function showToast(text, type = "normal") {
    ensureHUD();
    if (!toastEl) return;
    toastEl.innerText = text;
    toastEl.className = 'aa-toast visible';
    if (type === "success") toastEl.classList.add('aa-green');
    if (type === "error") toastEl.classList.add('aa-red');
}

function updateFocusBox(targetRect) {
    ensureHUD();
    if (!focusBoxEl) return;
    
    if (targetRect) {
        focusBoxEl.style.top = targetRect.top + "px";
        focusBoxEl.style.left = targetRect.left + "px";
        focusBoxEl.style.width = targetRect.width + "px";
        focusBoxEl.style.height = targetRect.height + "px";
        focusBoxEl.classList.add('visible');
    } else {
        focusBoxEl.classList.remove('visible');
    }
}

// --- MESSAGING ---
try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        waitForBody(() => initAgent());
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        waitForBody(() => initTarget());
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

function waitForBody(cb) {
    if (document.body) return cb();
    const obs = new MutationObserver(() => {
        if (document.body) { obs.disconnect(); cb(); }
    });
    obs.observe(document.documentElement, { childList: true });
}

// --- AGENT LOGIC ---

function initAgent() {
  console.log("[System] Agent Armed.");
  showToast("1. TYPE PROMPT  |  2. CLICK SEND");
  
  // High-Speed Visual Tracker
  setInterval(trackFocusState, 200);
  
  startInputMonitor();
  armAgentTrap();
  observeAgentOutput();
}

// 1. DEEP FOCUS TRACKER (The "Lock")
function trackFocusState() {
    // 1. Find the REAL focused element (piercing Shadow DOMs)
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
    }
    
    // 2. Is it a valid input?
    const isInput = el && (
        el.matches('input, textarea, [contenteditable="true"], [role="textbox"]') ||
        // Heuristic fallback: if it has no tag but is active, it might be a canvas/custom editor
        (el.tagName.includes('-') && el.isContentEditable) 
    );

    if (isInput) {
        activeInput = el;
        updateFocusBox(el.getBoundingClientRect());
    } else {
        // If user clicked away, keep the box on the last known valid input for a few seconds
        // or hide it. Here we hide it to be cleaner.
        // updateFocusBox(null);
    }
}

// 2. INPUT MONITOR
function startInputMonitor() {
    window.addEventListener('input', (e) => {
        if (!e.isTrusted) return;
        const target = e.composedPath()[0]; // Get true target
        if (isInput(target)) {
            draftText = target.value || target.innerText || "";
            if (draftText.length > 0) showToast("READY TO SEND...", "normal");
        }
    }, true);
}

function isInput(el) {
    if (!el || !el.matches) return false;
    return el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

// 3. THE TRAP
function armAgentTrap() {
    window.addEventListener('keydown', handleKeyBlockade, true);
    window.addEventListener('mousedown', handleMouseTrap, true);
}

function handleKeyBlockade(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Enter' && !e.shiftKey) {
        let target = e.composedPath()[0]; 
        if (isInput(target)) {
            console.log("[System] Enter Blocked");
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showToast("⛔ ENTER DISABLED. CLICK SEND.", "error");
        }
    }
}

function handleMouseTrap(e) {
    if (!e.isTrusted) return;

    const path = e.composedPath();
    const btn = path.find(el => {
        return el.tagName && (
            el.matches('button, [role="button"], input[type="submit"]') ||
            el.getAttribute('data-testid')?.includes('send') ||
            el.getAttribute('aria-label')?.includes('send')
        );
    });

    if (btn) {
        // Only trap if we have a draft
        if (draftText.length > 0) {
            console.log("[System] TRAPPED CLICK on:", btn);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            showToast("🔒 INJECTING...", "success");
            
            // We use 'activeInput' derived from the tracker loop
            const inputToUse = activeInput || Heuristics.findBestInput();
            
            executeInjectionSequence(inputToUse, btn, draftText);
        }
    }
}

// 4. EXECUTION
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    if (!inputElement) {
        showToast("❌ ERROR: INPUT LOST", "error");
        return;
    }

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
            updateFocusBox(el.getBoundingClientRect()); // Reuse focus box for target highlight
            setTimeout(() => {
                if (cmd.action === "click") el.click();
                if (cmd.action === "type") setNativeValue(el, cmd.value);
                updateFocusBox(null);
                chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "APPEND", content: `OK: ${cmd.action} -> ${cmd.id}` } });
            }, 500);
        }
    } else if (cmd.tool === "browser" && cmd.action === "find") {
        const found = window.find(cmd.value);
        chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "APPEND", content: `Search '${cmd.value}': ${found ? "FOUND" : "NO RESULT"}` } });
    }
}
