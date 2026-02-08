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
      // If we receive an update, simply log it if possible
      if (role === "AGENT") {
         console.log("[AgentAnything] Target Update Received:", msg.payload);
         // You could append this to the chat if the lock isn't active, 
         // but for Trap & Swap we mostly care about the next prompt.
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
  
  // Arm the trap to catch the user's prompt
  armAgentTrap();
  
  // Start observing output so we catch the response when it comes
  observeAgentOutput();
}

function armAgentTrap() {
    // Capture events at window level
    window.addEventListener('keydown', handleKeyTrap, true);
    window.addEventListener('click', handleClickTrap, true);
}

function handleKeyTrap(e) {
    // Intercept Enter key (without Shift)
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
    // Intercept clicks on submit buttons
    const target = e.target.closest('button, [role="button"], input[type="submit"]');
    if (target) {
        // Find the input box associated with this interaction
        const input = Heuristics.findBestInput(); 
        if (input && input.value !== "") {
            console.log("[System] Trap Triggered by CLICK");
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

    // 5. SUBMIT
    showStatusBadge("🚀 LAUNCHING AGENT...");
    
    setTimeout(() => {
        if (buttonElement) {
            // Bypass guard for this specific click
            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            buttonElement.dispatchEvent(clickEvent);
        } else {
            // Fire Enter
            const keyConfig = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputElement.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', keyConfig));
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
