console.log("%c [AgentAnything] QUEUE SYSTEM LOADED ", "background: #222; color: #00ff00; font-size: 14px;");

let role = null;
let lastSource = ""; 

// --- IMMORTAL UI (Simplified for Brevity - Insert previous `ensureUI` logic here if needed) ---
// Note: Keeping the UI logic from previous step is recommended. 
// For this snippet, I will focus on the Logic integration.
function setStatus(text) { console.log(`[STATUS] ${text}`); /* Re-add UI hook here */ }

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
  }
});

// --- AGENT LOGIC ---
function initAgent() {
    setStatus("AGENT: WAITING FOR QUEUE");
    
    // 1. Trap User Input -> Send to Queue
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const el = e.target;
            if (isInput(el) && el.value.trim() !== "") {
                e.preventDefault();
                e.stopImmediatePropagation();
                
                // Send to Background Queue
                chrome.runtime.sendMessage({ 
                    action: "QUEUE_INPUT", 
                    source: "USER", 
                    payload: el.value 
                });
                
                // Visual feedback
                el.value = ""; // Clear input
                setStatus("SENT TO QUEUE");
            }
        }
    }, true);

    // 2. Scan for Magic Token "[WAITING]"
    observeAgentOutput();
}

function injectAgentPrompt(text) {
    const input = Heuristics.findBestInput();
    if (!input) return;

    setStatus("PROCESSING QUEUE ITEM...");
    setNativeValue(input, text);
    
    // Auto-Send
    setTimeout(() => {
        const btn = Heuristics.findSendButton();
        if (btn) btn.click();
        else {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }
    }, 300);
}

function observeAgentOutput() {
    const observer = new MutationObserver(() => {
        const bodyText = document.body.innerText;
        
        // 1. Check for Commands
        if (bodyText.includes('```json')) {
             parseCommands(bodyText);
        }

        // 2. Check for END OF TURN Token
        if (bodyText.includes('[WAITING]')) {
            // We found the token. But we need to ensure we haven't already signaled for this specific turn.
            // A simple debounce or "seen" check is usually enough, 
            // but the background handles the lock, so we can just blast it.
            // Ideally, we only signal if we are technically "Busy". 
            // But since background manages state, we just report what we see.
            
            // To prevent spamming the background every millisecond:
            if (lastSource !== bodyText.length) { 
                chrome.runtime.sendMessage({ action: "AGENT_READY" });
                lastSource = bodyText.length; // Simple change detection
                setStatus("AGENT: RESTING");
            }
        }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

// --- TARGET LOGIC ---
function initTarget() {
    // Initial Report
    setTimeout(() => reportState("INITIAL LINK"), 1000);
}

function reportState(reason = "UPDATE") {
    const map = Heuristics.generateMap();
    // report only essential structure to save tokens
    const report = `[REASON: ${reason}]\nURL: ${window.location.href}\nELEMENTS:\n${map.map(i => `${i.id} | ${i.tag} | ${i.text}`).join('\n')}`;
    
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { content: report } 
    });
}

function executeCommand(cmd) {
    // ... Existing interaction logic ...
    // AFTER interaction is done:
    setTimeout(() => {
        reportState(`ACTION_COMPLETED: ${cmd.action}`);
    }, 1000);
}

// --- UTILS ---
// (Include Heuristics and setNativeValue from previous steps)
const Heuristics = {
    findBestInput: () => document.querySelector('textarea, input[type="text"], [contenteditable="true"]'),
    findSendButton: () => document.querySelector('button[aria-label*="send"], button[data-testid*="send"]'),
    // ... full heuristics engine ...
};

function setNativeValue(el, val) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor && descriptor.set) { descriptor.set.call(el, val); }
    else { el.value = val; el.innerText = val; }
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function isInput(el) { return el.matches('input, textarea, [contenteditable="true"]'); }
function parseCommands(text) { /* ... json parser ... */ }
