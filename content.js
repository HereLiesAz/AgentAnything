let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
let inputGuardActive = false;

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
    case "INJECT_UPDATE":
      if (role === "AGENT") {
         console.log("[AgentAnything] Target Update Received");
      }
      break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// --- AGENT LOGIC: THE TRAP & SWAP ---

function initAgent() {
  console.log("[System] Agent Armed. Waiting for user input...");
  showStatusBadge("🕵️ AGENT ARMED: Type & Submit normally");
  
  armAgentTrap();
  observeAgentOutput();
}

function armAgentTrap() {
    window.addEventListener('keydown', handleKeyTrap, true);
    window.addEventListener('click', handleClickTrap, true);
}

function handleKeyTrap(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target;
        if (target.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) {
            console.log("[System] Trap Triggered by ENTER");
            e.preventDefault();
            e.stopPropagation();
            executeTrapAndSwap(target, null); 
        }
    }
}

function handleClickTrap(e) {
    // Robust selector for clicking send buttons/icons
    const target = e.target.closest('button, [role="button"], input[type="submit"], [data-testid*="send"], svg');
    
    if (target) {
        const input = Heuristics.findBestInput(); 
        // We only trap if there is text in the input
        if (input && (input.value || input.innerText)) {
            console.log("[System] Trap Triggered by CLICK on", target);
            e.preventDefault();
            e.stopPropagation();
            executeTrapAndSwap(input, target);
        }
    }
}

async function executeTrapAndSwap(inputElement, buttonElement) {
    // 1. LOCK DOWN
    window.removeEventListener('keydown', handleKeyTrap, true);
    window.removeEventListener('click', handleClickTrap, true);
    enableInputGuard(); 
    showStatusBadge("⚙️ INJECTING PAYLOAD...");

    // 2. GET DATA
    let userPrompt = inputElement.value || inputElement.innerText || "";
    
    // Fetch Target Map
    const response = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    const targetData = response || { content: "NO TARGET CONNECTED", url: "N/A" };
    
    // Fetch System Context
    const storage = await chrome.storage.sync.get({ universalContext: '' });
    const universal = storage.universalContext ? `\n\n[CONTEXT]:\n${storage.universalContext}` : "";

    // 3. COMPOSE PAYLOAD
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
${userPrompt}
`;

    // 4. INJECT
    setNativeValue(inputElement, ""); 
    await visualType(inputElement, finalPayload);

    // 5. SUBMIT (THE SWAP)
    showStatusBadge("🚀 LAUNCHING AGENT...");
    
    setTimeout(() => {
        let sent = false;

        // PATH A: Button Click was trapped
        if (buttonElement) {
            // Resurrection Check: Is the button still valid?
            let targetBtn = buttonElement;
            if (!buttonElement.isConnected) {
                console.warn("[System] Trapped button is dead. Hunting for replacement...");
                const freshBtn = Heuristics.findSendButton();
                if (freshBtn) targetBtn = freshBtn;
            }

            if (targetBtn && targetBtn.isConnected) {
                console.log("[System] Firing Nuclear Click on", targetBtn);
                const opts = { view: window, bubbles: true, cancelable: true, buttons: 1 };
                targetBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                targetBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                targetBtn.dispatchEvent(new MouseEvent('click', opts));
                sent = true;
            }
        }

        // PATH B: Fallback / Enter Key
        if (!sent) {
            console.log("[System] Firing Enter Key Fallback");
            const keyConfig = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
            
            // Native Form Submit Try
            if (inputElement.form) inputElement.form.requestSubmit ? inputElement.form.requestSubmit() : inputElement.form.submit();
        }
    }, 500);
}

// --- UTILITIES ---

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
    // Wake up framework state listeners
    ['beforeinput', 'input', 'change'].forEach(evt => {
        input.dispatchEvent(new Event(evt, { bubbles: true }));
    });
}

function enableInputGuard() {
    if (inputGuardActive) return;
    inputGuardActive = true;
    
    const blockEvent = (e) => {
        if (!e.isTrusted) return; // Allow scripts
        e.stopPropagation();
        e.preventDefault();
    };
    
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'focus'].forEach(evt => {
        window.addEventListener(evt, blockEvent, true); 
    });
}

function showStatusBadge(text) {
    let badge = document.getElementById('aa-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'aa-status-badge';
        badge.style.cssText = `
            position: fixed; bottom: 20px; left: 20px; 
            background: #252525; color: #fff; padding: 10px 15px; 
            border: 1px solid #444; border-radius: 5px;
            font-family: sans-serif; font-size: 12px; z-index: 999999;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 10px;
        `;
        
        const btn = document.createElement('button');
        btn.innerText = "❌";
        btn.style.cssText = "background:none; border:none; cursor:pointer; color: #ff5555; font-size: 14px;";
        btn.onclick = () => chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
        
        badge.appendChild(document.createTextNode(text));
        badge.appendChild(btn);
        document.body.appendChild(badge);
    } else {
        badge.childNodes[0].textContent = text;
    }
}

// --- AGENT OUTPUT PARSER ---
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
    showStatusBadge(`⚙️ EXEC: ${json.action} on ${json.id}`);
  }
}

// --- TARGET LOGIC ---
function initTarget() {
  showStatusBadge("🎯 TARGET ACTIVE");
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
