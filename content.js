let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
let lastReportedContent = "";
let knownDomainContexts = new Set(); 
let observationDeck = null;

// --- INITIALIZATION HANDSHAKE ---
// This runs immediately when the script loads on ANY page.
// It asks the background: "Do I have a job?"
chrome.runtime.sendMessage({ action: "HELLO" });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      if (role !== "AGENT") { // Prevent double-init
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

// --- AGENT LOGIC ---

function initAgentUI() {
  console.log("%c AGENT ACTIVATED ", "background: #000; color: #0f0; font-size: 20px;");
  
  // Create UI first so we know it's working
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
    
    // Only copy prompt if this is a fresh manual activation, 
    // to avoid clobbering clipboard on random reloads.
    // We assume if the deck was just created, we prompt.
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
    position: fixed; top: 0; right: 0; width: 350px; background: #050505; color: #0f0;
    border-left: 1px solid #333; height: 100vh; z-index: 2147483647; padding: 10px;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; white-space: pre-wrap; 
    overflow-y: auto; box-shadow: -5px 0 15px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(observationDeck);
  
  const header = document.createElement('div');
  header.innerHTML = `<span style="color:#666">STATUS:</span> <span style="color:#0f0; font-weight:bold">ONLINE</span>`;
  header.style.borderBottom = "1px solid #333";
  header.style.paddingBottom = "5px";
  header.style.marginBottom = "10px";
  observationDeck.appendChild(header);
}

function observeAIOutput() {
  const observer = new MutationObserver((mutations) => {
    // Look for JSON blocks in the ENTIRE body. 
    // Modern AI chats render incrementally, so we scan frequently.
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
      const jsonStr = match[1];
      // Clean up common AI json errors (trailing commas, etc) if possible
      // But standard JSON.parse is strict.
      const json = JSON.parse(jsonStr);
      const sig = JSON.stringify(json);
      
      if (sig !== lastCommandSignature) {
        lastCommandSignature = sig;
        console.log("Dispatching command:", json);
        
        chrome.runtime.sendMessage({ 
          action: "AGENT_COMMAND", 
          payload: { ...json, targetTabId: window.activeTargetId } 
        });
        
        notify(`Sent: ${json.tool}.${json.action}`);
        
        // Visual feedback in deck
        const line = document.createElement('div');
        line.style.color = "#888";
        line.innerText = `>> SENT: ${json.action}`;
        observationDeck.appendChild(line);
        observationDeck.scrollTop = observationDeck.scrollHeight;
      }
    } catch (e) {
      // AUTO-CORRECTION:
      // If parsing fails, we don't just log it. We tell the AI.
      // This is tricky because we can't easily type into the chat box.
      // So we flash a big error in the user's face or the logs.
      console.error("Agent JSON Syntax Error", e);
    }
  }
}

function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;
  createObservationDeck();
  const obsWin = document.getElementById('aa-observation-deck');

  // --- CORTEX DOMAIN CHECK ---
  if (payload.url) {
    try {
      const hostname = new URL(payload.url).hostname;
      const cleanHost = hostname.replace(/^www\./, '');
      
      if (!knownDomainContexts.has(cleanHost)) {
        chrome.storage.sync.get({ domainContexts: {} }, (items) => {
           const context = items.domainContexts[hostname] || items.domainContexts[cleanHost];
           if (context) {
             const contextMsg = `\n\n[CORTEX MEMORY: ${cleanHost}]\n${context}\n`;
             obsWin.innerText += contextMsg;
             knownDomainContexts.add(cleanHost);
           }
        });
      }
    } catch (e) {}
  }

  // --- UI UPDATE ---
  if (payload.type === "APPEND") {
    // Clean previous "END UPDATE" markers to make it a continuous stream
    obsWin.innerHTML = obsWin.innerHTML.replace(/<br>\[END UPDATE\]/g, "");
    
    const newContent = document.createElement('div');
    newContent.innerText = payload.content;
    newContent.style.borderLeft = "2px solid #0f0";
    newContent.style.paddingLeft = "5px";
    newContent.style.marginTop = "5px";
    obsWin.appendChild(newContent);
    
    const footer = document.createElement('div');
    footer.innerText = "[END UPDATE]";
    footer.style.color = "#666";
    footer.style.fontSize = "9px";
    obsWin.appendChild(footer);

    obsWin.scrollTop = obsWin.scrollHeight;
  } else {
    // REPLACE
    obsWin.innerHTML = ""; // Wipe
    const header = document.createElement('div');
    header.innerHTML = `<span style="color:#666">CONNECTED TO:</span> <span style="color:#fff">${sourceId}</span>`;
    header.style.borderBottom = "1px solid #333";
    obsWin.appendChild(header);

    const content = document.createElement('div');
    content.innerText = payload.content;
    obsWin.appendChild(content);
    
    const footer = document.createElement('div');
    footer.innerText = "[END UPDATE]";
    footer.style.color = "#666";
    footer.style.fontSize = "9px";
    obsWin.appendChild(footer);
  }
}


// --- TARGET LOGIC ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  // Visual Indicator for Target
  const indicator = document.createElement('div');
  indicator.innerText = "TARGET";
  indicator.style.cssText = "position:fixed;bottom:10px;right:10px;background:red;color:white;padding:2px 5px;z-index:999999;font-size:10px;font-family:monospace;pointer-events:none;opacity:0.5;";
  document.body.appendChild(indicator);

  // Allow DOM to settle
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
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
           const range = sel.getRangeAt(0);
           const rect = range.getBoundingClientRect();
           
           const spot = document.createElement('div');
           spot.style.cssText = `
             position: absolute; top: ${window.scrollY + rect.top}px; left: ${window.scrollX + rect.left}px;
             width: ${rect.width}px; height: ${rect.height}px;
             background: rgba(255, 255, 0, 0.5); z-index: 999999; pointer-events: none;
           `;
           document.body.appendChild(spot);
           setTimeout(() => spot.remove(), 2000);
           
           chrome.runtime.sendMessage({ 
             action: "TARGET_UPDATE", 
             payload: { type: "APPEND", content: `\n[BROWSER]: Found "${cmd.value}" and scrolled to it.`, url: window.location.href }
           });
        }
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
        payload: { type: "APPEND", content: `\n[ERROR]: Element ${cmd.id} missing (DOM Shifted?).`, url: window.location.href }
    });
    return;
  }

  const originalBorder = el.style.border;
  el.style.border = "2px solid #0f0";
  setTimeout(() => el.style.border = originalBorder, 500);

  try {
    if (cmd.action === "click") {
      el.click();
      el.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Enter'}));
    } 
    else if (cmd.action === "type") {
      el.value = cmd.value;
      el.innerText = cmd.value; 
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    else if (cmd.action === "read") {
        chrome.runtime.sendMessage({ 
          action: "TARGET_UPDATE", 
          payload: { type: "APPEND", content: `\n[READ]: ${el.innerText || el.value}`, url: window.location.href }
        });
    }
  } catch (err) {
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { type: "APPEND", content: `\n[ERROR]: ${err.message}`, url: window.location.href } 
    });
  }
}

// Utils
function notify(msg) {
  const n = document.createElement('div');
  n.innerText = msg;
  n.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:red;color:white;padding:5px;z-index:2147483647;font-family:monospace;";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(err => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}
