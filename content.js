console.log("%c [AgentAnything] TRAP RESTORED ", "background: #000; color: #00ff00; font-size: 16px; font-weight: bold;");

// --- STATE ---
let role = null;
let lastBodyLen = 0;
let bootInterval = null;
let activeInput = null; 
let isWaitingForGenesisInput = true;

// --- BOOTSTRAPPER ---
function boot() {
    if (!document.body) return;
    if (!window.AA_Heuristics) return;

    if (bootInterval) clearInterval(bootInterval);
    console.log("[AgentAnything] UI Mounting.");
    ensureUI();
    startMessaging();
}
bootInterval = setInterval(boot, 100);

// --- UI ENGINE ---
let shadowHost = null;
let shadowRoot = null;
let panelEl = null;

function ensureUI() {
    if (shadowHost && shadowHost.isConnected) return;
    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-ui-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        .aa-panel {
            position: fixed !important; bottom: 20px !important; left: 20px !important;
            background: #1a1a1a !important; border: 1px solid #333 !important; color: #e0e0e0 !important;
            font-family: monospace !important; font-size: 12px !important; padding: 8px 12px !important;
            border-radius: 6px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.8) !important;
            display: flex !important; align-items: center !important; gap: 10px !important; 
            pointer-events: auto !important; z-index: 2147483647 !important; min-width: 120px;
        }
        .aa-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; }
        .aa-dot.blue { background: #88c0d0; box-shadow: 0 0 5px #88c0d0; }
        .aa-dot.green { background: #a3be8c; box-shadow: 0 0 5px #a3be8c; }
        .aa-dot.purple { background: #b48ead; box-shadow: 0 0 5px #b48ead; }
        .aa-dot.red { background: #bf616a; box-shadow: 0 0 5px #bf616a; }
        .aa-dot.neon { background: #0f0; box-shadow: 0 0 8px #0f0; }
    `;
    shadowRoot.appendChild(style);
    panelEl = document.createElement('div');
    panelEl.className = 'aa-panel';
    panelEl.innerHTML = `<div class="aa-dot" id="dot"></div><span id="txt">STANDBY...</span>`;
    shadowRoot.appendChild(panelEl);
}

function setStatus(text, color) {
    if (!shadowRoot) ensureUI();
    const dot = shadowRoot.getElementById('dot');
    const txt = shadowRoot.getElementById('txt');
    if (dot && txt) {
        dot.className = `aa-dot ${color}`;
        txt.innerText = text;
    }
}

// --- LOGIC ---
function startMessaging() {
    setInterval(() => {
        if (!role) {
            try { chrome.runtime.sendMessage({ action: "HELLO" }); } catch(e) {}
        }
    }, 2000);

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
}

function initAgent() {
    setStatus("AGENT: READY - WAITING FOR PROMPT", "blue");
    const Heuristics = window.AA_Heuristics;

    // Highlight inputs immediately
    document.addEventListener('mouseover', (e) => {
        if (isWaitingForGenesisInput) {
            const el = e.target;
            if (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable) {
                el.style.outline = "2px dashed #00ff00";
            }
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (isWaitingForGenesisInput) {
            const el = e.target;
            if (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable) {
                el.style.outline = "";
            }
        }
    }, true);

    window.addEventListener('focus', (e) => {
        if (['INPUT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
            activeInput = e.target;
            if (isWaitingForGenesisInput) e.target.style.outline = "3px solid #00ff00";
        }
    }, true);
    
    // ENTER KEY TRAP
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const el = e.target;
            if (['INPUT','TEXTAREA'].includes(el.tagName) || el.isContentEditable) {
                const val = el.value || el.innerText;
                if (val && val.trim().length > 0) {
                    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                    triggerInterception(val, el);
                }
            }
        }
    }, true);

    // CLICK TRAP (Restored Logic)
    window.addEventListener('click', (e) => {
        const path = e.composedPath();
        const btn = path.find(el => el.tagName && (
            el.matches('button, [role="button"], input[type="submit"]') ||
            el.getAttribute('data-testid')?.includes('send') ||
            el.getAttribute('aria-label')?.includes('send') ||
            (el.innerText && el.innerText.match(/send|submit/i))
        ));

        if (btn) {
            const input = activeInput || Heuristics.findBestInput();
            const val = input ? (input.value || input.innerText) : "";
            
            if (val && val.trim().length > 0) {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                triggerInterception(val, input);
            }
        }
    }, true);

    observeAgentOutput();
}

function triggerInterception(text, inputEl) {
    // Only capture if we are waiting for input or if we are already running loop
    // But actually, we always capture inputs on Agent tab to feed them into the loop.

    if (inputEl) {
        inputEl.style.outline = "3px solid #00ff00"; // NEON GREEN

        // Improved React/Vue handling
        try {
            const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inputEl), 'value');
            if (descriptor && descriptor.set) {
                 descriptor.set.call(inputEl, "");
            } else {
                 inputEl.value = "";
            }
        } catch(e) {
             inputEl.value = "";
        }

        if(inputEl.innerText) inputEl.innerText = "";

        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (isWaitingForGenesisInput) {
        setStatus("GENESIS PROMPT CAPTURED", "neon");
        isWaitingForGenesisInput = false; // Lock UX

        // Disable interactions except scrolling
        const style = document.createElement('style');
        style.id = 'aa-lock-style';
        style.textContent = `
            body * { pointer-events: none !important; }
            body, html { pointer-events: auto !important; }
            ::-webkit-scrollbar { width: 10px; }
            ::-webkit-scrollbar-thumb { background: #555; }
        `;
        document.head.appendChild(style);

        chrome.runtime.sendMessage({ action: "GENESIS_INPUT_CAPTURED", payload: text });
    } else {
        setStatus("INTERCEPTED", "neon");
        chrome.runtime.sendMessage({ action: "QUEUE_INPUT", source: "USER", payload: text });
    }
}

function injectAgentPrompt(text) {
    const Heuristics = window.AA_Heuristics;
    const input = Heuristics.findBestInput();
    
    if (!input) {
        console.error("Input not found");
        return;
    }

    setStatus("INJECTING...", "purple");
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, text);
    else input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));

    setTimeout(() => {
        const btn = Heuristics.findSendButton();
        if (btn) btn.click();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        setStatus("AGENT: WORKING", "red");
    }, 500);
}

function observeAgentOutput() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const bodyText = document.body.innerText;
            if (bodyText.includes('```json')) parseCommands(bodyText);
            if (bodyText.includes('[WAITING]')) {
                 if (Math.abs(bodyText.length - lastBodyLen) > 50) {
                    chrome.runtime.sendMessage({ action: "AGENT_READY" });
                    lastBodyLen = bodyText.length;
                    setStatus("AGENT: WAITING", "blue");
                }
            }
        }, 500);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
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

// --- TARGET ---
function initTarget() {
    setStatus("TARGET: LINKED", "green");
    setTimeout(() => reportState("INITIAL"), 1000);
}

function reportState(reason) {
    const Heuristics = window.AA_Heuristics;
    const map = Heuristics.generateMap();
    const content = Heuristics.findMainContent().innerText.substring(0, 3000);
    const report = `[REASON: ${reason}]\nURL: ${window.location.href}\nELEMENTS:\n${map.map(i => `${i.id} | ${i.tag} | ${i.text}`).join('\n')}\nCONTENT SNAPSHOT:\n${content}`;
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: { content: report } });
}

function executeCommand(cmd) {
    const Heuristics = window.AA_Heuristics;
    if (cmd.tool === "interact") {
        const el = Heuristics.getElementByAAId(cmd.id);
        if (el) {
            el.scrollIntoView({ block: "center" });
            el.style.outline = "3px solid #0f0";
            setTimeout(() => {
                if (cmd.action === "click") el.click();
                if (cmd.action === "type") {
                    el.value = cmd.value;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                }
                el.style.outline = "";
                setTimeout(() => reportState("ACTION_DONE"), 1000);
            }, 500);
        }
    }
}
