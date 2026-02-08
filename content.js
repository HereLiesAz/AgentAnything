console.log("%c [AgentAnything] SYSTEM LOADED ", "background: #222; color: #bada55; font-size: 14px; padding: 4px;");

let role = null;
let myTabId = null;
let lastCommandSignature = "";
let draftText = "";
let activeInput = null;

// --- LOCKING STATE ---
let agentLocked = false; 

// --- IMMORTAL UI ---
let shadowHost = null;
let shadowRoot = null;
let panelEl = null;   
let toastEl = null;   

function ensureUI() {
    if (!document.body) return;
    if (shadowHost && !shadowHost.isConnected) shadowHost = null; 
    if (shadowHost) return; 

    try {
        shadowHost = document.createElement('div');
        shadowHost.id = 'aa-ui-host';
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
            .aa-dot.pink { background: #b48ead; box-shadow: 0 0 5px #b48ead; } 

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
        panelEl.className = 'aa-panel';
        panelEl.innerHTML = `<div class="aa-dot" id="dot"></div><span id="txt">WAITING...</span>`;
        shadowRoot.appendChild(panelEl);

        toastEl = document.createElement('div');
        toastEl.className = 'aa-toast';
        shadowRoot.appendChild(toastEl);
    } catch (e) {
        console.error("[AgentAnything] UI Injection Failed:", e);
    }
}

function setStatus(text, color) {
    ensureUI();
    if (!shadowRoot) return;
    const dot = shadowRoot.getElementById('dot');
    const txt = shadowRoot.getElementById('txt');
    if (dot && txt) {
        dot.className = `aa-dot ${color}`;
        txt.innerText = text;
    }
}

function showToast(text) {
    ensureUI();
    if (!shadowRoot) return;
    toastEl.innerText = text;
    toastEl.classList.add('visible');
    setTimeout(() => toastEl.classList.remove('visible'), 3000);
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      role = "AGENT";
      initAgent();
      break;
    case "INIT_TARGET":
      role = "TARGET";
      myTabId = msg.tabId;
      initTarget();
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "REMOTE_INJECT":
      if (role === "AGENT") handleRemoteCommand(msg.payload);
      break;
    case "INJECT_UPDATE":
        // THE UNLOCK KEY: Target has responded.
        if (role === "AGENT") {
            agentLocked = false;
            setStatus("AGENT: ARMED", "blue");
            showToast("TARGET UPDATED");
        }
        break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// Hello loop
setInterval(() => {
    if (!role) {
        try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}
    } else {
        ensureUI();
        if (role === "AGENT" && !agentLocked) {
             if (activeInput && activeInput.isConnected) activeInput.style.outline = "2px solid #a3be8c";
             else activeInput = Heuristics.findBestInput();
        }
    }
}, 1000);

// --- AGENT ---
function initAgent() {
    setStatus("AGENT: ARMED", "blue");
    window.addEventListener('input', (e) => {
        if (isInput(e.target)) {
            activeInput = e.target;
            draftText = e.target.value || e.target.innerText;
            if (!agentLocked) e.target.style.outline = "2px solid #a3be8c";
        }
    }, true);
    
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && draftText.length > 0 && isInput(e.target)) {
            // LOCK CHECK
            if (agentLocked) {
                e.preventDefault(); e.stopImmediatePropagation();
                showToast("⛔ WAITING FOR TARGET...");
                return;
            }

            e.preventDefault();
            e.stopImmediatePropagation();
            setStatus("TRAP: ENTER", "yellow");
            executeInjection(e.target, null, draftText);
        }
    }, true);

    window.addEventListener('mousedown', (e) => {
        const el = e.target;
        if (activeInput && draftText.length > 0 && (
            el.tagName === 'BUTTON' || el.closest('button') || el.getAttribute('role') === 'button'
        )) {
            // LOCK CHECK
            if (agentLocked) {
                e.preventDefault(); e.stopImmediatePropagation();
                showToast("⛔ WAITING FOR TARGET...");
                return;
            }

            e.preventDefault();
            e.stopImmediatePropagation();
            setStatus("TRAP: CLICK", "yellow");
            executeInjection(activeInput, el, draftText);
        }
    }, true);
    
    observeOutput();
}

function isInput(el) {
    return el.matches && el.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

// --- TARGET ---
function initTarget() {
    setStatus("TARGET: LINKED", "green");
    // Initial report, but rely on updates for synchronization
    reportState();
}

function reportState() {
    const map = Heuristics.generateMap();
    const content = Heuristics.findMainContent().innerText.substring(0, 5000);
    const report = `ELEMENTS:\n${map.map(i => `ID: "${i.id}" | ${i.tag} | "${i.text}"`).join('\n')}\nCONTENT:\n${content}`;
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { type: "FULL", content: report, url: window.location.href } });
}

// --- EXECUTION ---
async function executeInjection(input, btn, text) {
    agentLocked = true; // LOCK ENGAGED
    setStatus("WAITING FOR TARGET...", "pink");
    
    let context = { content: "NO TARGET" };
    try { context = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" }) || context; } catch(e){}

    const payload = `
[SYSTEM: AGENT ROLE]
[PROTOCOL: JSON]
Interact: {"tool": "interact", "id": "...", "action": "click"|"type", "value": "..."}
Browser: {"tool": "browser", "action": "refresh"|"back", "value": "..."}

[TARGET]: ${context.url}
${context.content}

[USER]: ${text}
`;

    setNativeValue(input, payload);
    
    setTimeout(() => {
        if (btn) triggerClick(btn);
        else if (Heuristics.findSendButton()) triggerClick(Heuristics.findSendButton());
        else {
            const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
            input.dispatchEvent(new KeyboardEvent('keydown', k));
            input.dispatchEvent(new KeyboardEvent('keyup', k));
        }
        draftText = "";
        // DO NOT UNLOCK HERE. Wait for INJECT_UPDATE.
    }, 200);
}

function triggerClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
}

function setNativeValue(el, val) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor && descriptor.set) { descriptor.set.call(el, val); }
    else { el.value = val; el.innerText = val; }
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function observeOutput() {
    const observer = new MutationObserver(() => {
        const txt = document.body.innerText;
        if (txt.includes('```json')) {
            const match = txt.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (match) {
                try {
                    const json = JSON.parse(match[1]);
                    if (JSON.stringify(json) !== lastCommandSignature) {
                        lastCommandSignature = JSON.stringify(json);
                        chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json });
                        showToast(`CMD: ${json.action}`);
                    }
                } catch(e) {}
            }
        }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

function handleRemoteCommand(txt) {
    if (activeInput && !agentLocked) executeInjection(activeInput, null, txt);
}

// --- TARGET EXECUTION ---
function executeCommand(cmd) {
    showToast(`EXEC: ${cmd.action}`);
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ block: "center" });
            el.style.outline = "3px solid #0f0";
            setTimeout(() => {
                if (cmd.action === "click") triggerClick(el);
                if (cmd.action === "type") setNativeValue(el, cmd.value);
                el.style.outline = "";
                
                // WAIT FOR SETTLED DOM
                waitForSettledDOM(() => {
                    reportState();
                });
            }, 500);
        }
    }
}

// The Mutation Debouncer
function waitForSettledDOM(callback) {
    let timer = null;
    let maxTimer = null;
    
    // Hard limit: If page never settles, just send update after 4s
    maxTimer = setTimeout(() => {
        if (observer) observer.disconnect();
        callback();
    }, 4000);

    const observer = new MutationObserver(() => {
        // Reset the debounce timer on every change
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            clearTimeout(maxTimer);
            observer.disconnect();
            callback();
        }, 500); // 500ms silence required
    });

    observer.observe(document.body, { subtree: true, childList: true, attributes: true });

    // Initial trigger in case nothing changes
    timer = setTimeout(() => {
        clearTimeout(maxTimer);
        observer.disconnect();
        callback();
    }, 500);
}
