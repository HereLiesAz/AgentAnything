console.log("%c [AgentAnything] LOGIC LOADED ", "background: #000; color: #00ff00; font-size: 14px; font-weight: bold;");

let role = null;
let lastBodyLen = 0; 
let activeInput = null;

// --- IMMORTAL UI ---
let shadowHost = null;
let shadowRoot = null;
let panelEl = null;

function ensureUI() {
    if (!document.body) return;
    if (shadowHost && !shadowHost.isConnected) shadowHost = null; 
    if (shadowHost) return; 

    // Create shadow host
    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-ui-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(shadowHost);
    
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
        .aa-panel {
            position: fixed; bottom: 20px; left: 20px;
            background: #1a1a1a; border: 1px solid #333; color: #e0e0e0;
            font-family: monospace; font-size: 12px; padding: 8px 12px;
            border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.8);
            display: flex; align-items: center; gap: 10px; pointer-events: auto;
            z-index: 2147483647;
        }
        .aa-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; }
        .aa-dot.blue { background: #88c0d0; box-shadow: 0 0 5px #88c0d0; }
        .aa-dot.green { background: #a3be8c; box-shadow: 0 0 5px #a3be8c; }
        .aa-dot.purple { background: #b48ead; box-shadow: 0 0 5px #b48ead; }
        .aa-dot.red { background: #bf616a; box-shadow: 0 0 5px #bf616a; }
        .aa-dot.yellow { background: #ebcb8b; box-shadow: 0 0 5px #ebcb8b; }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.className = 'aa-panel';
    panelEl.innerHTML = `<div class="aa-dot" id="dot"></div><span id="txt">WAITING...</span>`;
    shadowRoot.appendChild(panelEl);
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

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.action) {
    case "INIT_AGENT":
      role = "AGENT";
      initAgent();
      break;
    case "INIT_TARGET":
      role = "TARGET";
      initTarget();
      break;
    case "INJECT_PROMPT":
      if (role === "AGENT") injectAgentPrompt(msg.payload);
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// Hello loop / Heartbeat
setInterval(() => {
    if (!role) {
        try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}
    } else {
        ensureUI();
        if (role === "AGENT") {
            const input = Heuristics.findBestInput();
            if (input && input.isConnected) input.style.outline = "2px solid #a3be8c";
        }
    }
}, 1000);

// --- AGENT LOGIC ---
function initAgent() {
    setStatus("AGENT: IDLE", "blue");
    
    // 1. Trap Enter Key -> Queue
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const el = e.target;
            // Check if it's a valid input
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true') {
                const val = el.value || el.innerText;
                if (val && val.trim().length > 0) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    
                    chrome.runtime.sendMessage({ 
                        action: "QUEUE_INPUT", 
                        source: "USER", 
                        payload: val 
                    });
                    
                    // Clear visual
                    if(el.value) el.value = "";
                    if(el.innerText) el.innerText = "";
                    
                    setStatus("SENT TO QUEUE", "purple");
                }
            }
        }
    }, true);

    // 2. Scan for [WAITING] token
    observeAgentOutput();
}

function injectAgentPrompt(text) {
    const input = Heuristics.findBestInput();
    if (!input) {
        console.error("No Input Found");
        return;
    }

    setStatus("INJECTING...", "purple");
    setNativeValue(input, text);
    
    setTimeout(() => {
        const btn = Heuristics.findSendButton();
        if (btn) {
            triggerClick(btn);
        } else {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }
        setStatus("AGENT: WORKING", "red");
    }, 500);
}

function observeAgentOutput() {
    const observer = new MutationObserver(() => {
        const bodyText = document.body.innerText;
        
        // 1. Parse Commands
        if (bodyText.includes('```json')) {
             parseCommands(bodyText);
        }

        // 2. Scan for End of Turn
        if (bodyText.includes('[WAITING]')) {
             // Heuristic: If we see the token, and the text length has changed significantly since we last checked
             if (Math.abs(bodyText.length - lastBodyLen) > 50) { 
                chrome.runtime.sendMessage({ action: "AGENT_READY" });
                lastBodyLen = bodyText.length; 
                setStatus("AGENT: WAITING", "blue");
            }
        }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

// --- TARGET LOGIC ---
function initTarget() {
    setStatus("TARGET: LINKED", "green");
    setTimeout(() => reportState("INITIAL_LINK"), 1000);
}

function reportState(reason = "UPDATE") {
    const map = Heuristics.generateMap();
    const content = Heuristics.findMainContent().innerText.substring(0, 3000);
    const report = `[REASON: ${reason}]\nURL: ${window.location.href}\nELEMENTS:\n${map.map(i => `${i.id} | ${i.tag} | ${i.text}`).join('\n')}\nCONTENT SNAPSHOT:\n${content}`;
    
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { content: report } 
    });
}

function executeCommand(cmd) {
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ block: "center" });
            el.style.outline = "3px solid #0f0";
            setTimeout(() => {
                if (cmd.action === "click") triggerClick(el);
                if (cmd.action === "type") setNativeValue(el, cmd.value);
                el.style.outline = "";
                
                waitForSettledDOM(() => {
                    reportState(`ACTION_DONE:${cmd.action}`);
                });
            }, 500);
        }
    }
}

// --- UTILS ---
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

function parseCommands(text) {
    const regex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        try {
            const json = JSON.parse(match[1]);
            chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json });
        } catch (e) {}
    }
}

function waitForSettledDOM(callback) {
    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { observer.disconnect(); callback(); }, 800);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    // Failsafe 3s
    setTimeout(() => { if(timer) clearTimeout(timer); observer.disconnect(); callback(); }, 3000);
}
