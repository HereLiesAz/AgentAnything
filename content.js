let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
let lastReportedContent = "";
let knownDomainContexts = new Set(); 
let observationDeck = null;

// --- INITIALIZATION HANDSHAKE ---
chrome.runtime.sendMessage({ action: "HELLO" });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") {
        role = "AGENT";
        initAgentUI();
      }
      break;
    case "INIT_TARGET":
      if (role !== "TARGET") {
        role = "TARGET";
        myTabId = msg.tabId;
        initTargetLogic();
      }
      break;
    case "EXECUTE_COMMAND":
      if (role === "TARGET") executeCommand(msg.command);
      break;
    case "INJECT_OBSERVATION":
      if (role === "AGENT") injectObservation(msg.sourceId, msg.payload);
      break;
  }
});

// --- AGENT LOGIC (THE BRAIN) ---

function initAgentUI() {
  console.log("%c AGENT ACTIVATED ", "background: #000; color: #0f0; font-size: 20px;");
  createObservationDeck();

  chrome.storage.sync.get({ universalContext: '' }, (items) => {
    const universal = items.universalContext ? `\n\n[UNIVERSAL CONTEXT]:\n${items.universalContext}` : "";

    const prompt = `
[SYSTEM: YOU ARE AN AGENT. YOU CONTROL A BROWSER TAB.]
I have connected you to a target tab.
Use the following JSON commands to manipulate it. 
Output ONLY raw JSON.

1. INTERACT WITH PAGE (Click/Type):
\`\`\`json
{
  "tool": "interact",
  "id": "ELEMENT_ID", 
  "action": "click" | "type" | "read",
  "value": "text" (for type)
}
\`\`\`

2. BROWSER CONTROL (Nav/Search):
\`\`\`json
{
  "tool": "browser",
  "action": "refresh" | "back" | "forward" | "find",
  "value": "search term" (only for find)
}
\`\`\`
${universal}

WAITING FOR TARGET...
    `;
    
    if (!window.hasPrompted) {
        copyToClipboard(prompt);
        notify("System Prompt Copied.");
        window.hasPrompted = true;
    }
    
    observeAIOutput();
  });
}

function createObservationDeck() {
  if (document.getElementById('aa-observation-deck')) return;
  
  observationDeck = document.createElement('div');
  observationDeck.id = 'aa-observation-deck';
  observationDeck.style.cssText = `
    position: fixed; top: 0; right: 0; width: 300px; background: #050505; color: #0f0;
    border-left: 1px solid #333; height: 100vh; z-index: 2147483647; padding: 10px;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 10px; white-space: pre-wrap; 
    overflow-y: auto; opacity: 0.9; pointer-events: none;
  `;
  document.body.appendChild(observationDeck);
}

function observeAIOutput() {
  const observer = new MutationObserver((mutations) => {
    const bodyText = document.body.innerText;
    if (bodyText.includes('```json') && bodyText.includes('```')) {
        parseCommands(bodyText);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function parseCommands(text) {
  const regex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const sig = JSON.stringify(json);
      
      if (sig !== lastCommandSignature) {
        lastCommandSignature = sig;
        console.log("Dispatching command:", json);
        
        chrome.runtime.sendMessage({ 
          action: "AGENT_COMMAND", 
          payload: { ...json, targetTabId: window.activeTargetId } 
        });
        
        notify(`Sent: ${json.tool}.${json.action}`);
        
        // Visual feedback
        const line = document.createElement('div');
        line.style.color = "#888";
        line.innerText = `>> COMMAND SENT: ${json.action}`;
        observationDeck.appendChild(line);
        observationDeck.scrollTop = observationDeck.scrollHeight;
      }
    } catch (e) {
      console.error("Agent JSON Syntax Error", e);
    }
  }
}

// --- THE AUTO-INPUT MODULE ---
function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;
  createObservationDeck();
  
  // 1. Update the visual deck (for human monitoring)
  updateVisualDeck(payload);

  // 2. Format the message for the AI
  let aiMessage = "";
  if (payload.type === "APPEND") {
    aiMessage = `\n[TARGET UPDATE]:\n${payload.content}`;
  } else {
    // Check Cortex Memory for this domain
    let contextMsg = "";
    if (payload.url) {
        try {
            const hostname = new URL(payload.url).hostname.replace(/^www\./, '');
            // Only fetch if we haven't seen this domain this session to avoid spamming the AI
            if (!knownDomainContexts.has(hostname)) {
                 // We can't act async here easily for the paste, so we rely on what's visually shown
                 // Ideally we'd fetch storage here, but for speed we'll skip for now 
                 // or you can enable it if you accept the async delay.
                 knownDomainContexts.add(hostname);
            }
        } catch(e) {}
    }
    aiMessage = `\n[TARGET CONNECTED]:\n${payload.content}\n\n[AWAITING COMMANDS]`;
  }

  // 3. AUTO-TYPE AND SEND
  // We use a debounce to prevent spamming if multiple updates come in fast
  if (window.inputDebounce) clearTimeout(window.inputDebounce);
  window.inputDebounce = setTimeout(() => {
      autoTypeIntoChat(aiMessage);
  }, 500);
}

function updateVisualDeck(payload) {
    if (payload.type === "APPEND") {
        const div = document.createElement('div');
        div.innerText = payload.content;
        div.style.borderLeft = "2px solid #0f0";
        div.style.marginTop = "5px";
        div.style.paddingLeft = "5px";
        observationDeck.appendChild(div);
    } else {
        observationDeck.innerHTML = `<div style="color:#666;border-bottom:1px solid #333">CONNECTED TO: ${payload.url}</div>`;
        const div = document.createElement('div');
        div.innerText = payload.content;
        observationDeck.appendChild(div);
    }
    observationDeck.scrollTop = observationDeck.scrollHeight;
}

function autoTypeIntoChat(text) {
    // Heuristic to find the main chat input
    // Works for ChatGPT, Claude, Gemini, DeepSeek
    const input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
    
    if (!input) {
        console.warn("AgentAnything: Could not find chat input box.");
        return;
    }

    // React/Vue Value Setter Hack
    // These frameworks override the standard .value property.
    // We have to call the native setter to trigger the internal state update.
    try {
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        const currentVal = input.value;
        
        // Append to existing text if any, to avoid overwriting user's draft
        const newVal = currentVal ? currentVal + "\n" + text : text;
        
        nativeTextAreaValueSetter.call(input, newVal);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
        // Fallback for contenteditable (like some versions of ChatGPT/Claude)
        input.innerText += text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Try to find the Send button
    // We wait briefly for the UI to register the text input
    setTimeout(() => {
        const sendBtn = document.querySelector('button[aria-label="Send"], button[data-testid="send-button"], button[aria-label="Submit"]');
        if (sendBtn) {
            sendBtn.click();
            notify("Auto-Submitted Update to AI");
        } else {
            // Fallback: Press Enter
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, keyCode: 13, key: 'Enter'
            });
            input.dispatchEvent(enterEvent);
            notify("Auto-Pressed Enter");
        }
    }, 200);
}


// --- TARGET LOGIC (THE BODY) ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  // Visual Indicator
  const indicator = document.createElement('div');
  indicator.innerText = "TARGET";
  indicator.style.cssText = "position:fixed;bottom:10px;right:10px;background:red;color:white;padding:2px 5px;z-index:999999;font-size:10px;font-family:monospace;pointer-events:none;opacity:0.5;";
  document.body.appendChild(indicator);

  setTimeout(() => {
      const map = Heuristics.generateMap();
      targetMap = map;
      const contentNode = Heuristics.findMainContent();
      
      const toolSchema = map.map(item => {
        return `ID: "${item.id}" | Type: ${item.tag} | Text: "${item.text}"`;
      }).join('\n');

      const fullReport = `
TARGET: ${document.title}
URL: ${window.location.href}

ELEMENTS:
${toolSchema}

CONTENT:
${contentNode.innerText.substring(0, 1000)}
      `;

      lastReportedContent = contentNode.innerText;
      
      chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { type: "REPLACE", content: fullReport, url: window.location.href } 
      });

      const observer = new MutationObserver(() => {
        if (window.debounceUpdate) clearTimeout(window.debounceUpdate);
        window.debounceUpdate = setTimeout(() => reportDiff(contentNode), 1000);
      });
      observer.observe(contentNode, { childList: true, subtree: true, characterData: true });
  }, 1000);
}

function reportDiff(node) {
  const currentText = node.innerText;
  if (currentText === lastReportedContent) return;

  let payload = {};
  if (currentText.startsWith(lastReportedContent)) {
    const newPart = currentText.substring(lastReportedContent.length);
    if (newPart.trim().length === 0) return;
    payload = { type: "APPEND", content: newPart, url: window.location.href };
  } else {
    payload = { 
        type: "REPLACE", 
        content: `[REFRESHED]\n${currentText.substring(0, 2000)}...`,
        url: window.location.href
    };
  }

  lastReportedContent = currentText;
  chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: payload });
}

function executeCommand(cmd) {
  if (cmd.tool === "browser" && cmd.action === "find") {
      const found = window.find(cmd.value);
      if (found) {
           chrome.runtime.sendMessage({ 
             action: "TARGET_UPDATE", 
             payload: { type: "APPEND", content: `\n[BROWSER]: Found "${cmd.value}".`, url: window.location.href }
           });
      } else {
        chrome.runtime.sendMessage({ 
          action: "TARGET_UPDATE", 
          payload: { type: "APPEND", content: `\n[BROWSER]: Text "${cmd.value}" not found.`, url: window.location.href }
        });
      }
    return;
  }

  const el = document.querySelector(`[data-aa-id="${cmd.id}"]`);
  
  if (!el) {
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { type: "APPEND", content: `\n[ERROR]: Element ${cmd.id} missing.`, url: window.location.href }
    });
    return;
  }

  // Highlight
  const originalBorder = el.style.border;
  el.style.border = "2px solid #0f0";
  setTimeout(() => el.style.border = originalBorder, 500);

  try {
    if (cmd.action === "click") {
      el.click();
    } 
    else if (cmd.action === "
