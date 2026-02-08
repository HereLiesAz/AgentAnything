let role = null;
let myTabId = null;
let targetMap = [];
let lastCommandSignature = "";
let lastReportedContent = "";
let knownDomainContexts = new Set(); 

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "INIT_AGENT":
      role = "AGENT";
      initAgentUI();
      break;
    case "INIT_TARGET":
      role = "TARGET";
      myTabId = msg.tabId;
      initTargetLogic();
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
    
    copyToClipboard(prompt);
    notify("System Prompt Copied.");
    observeAIOutput();
    
    // Create the observation deck immediately so we see the cached data arrive
    createObservationDeck();
  });
}

function createObservationDeck() {
  if (document.getElementById('aa-observation-deck')) return;
  
  const obsWin = document.createElement('div');
  obsWin.id = 'aa-observation-deck';
  obsWin.style.cssText = `
    position: fixed; top: 0; right: 0; width: 350px; background: #000; color: #0f0;
    border-left: 2px solid #333; height: 100vh; z-index: 999999; padding: 10px;
    font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-y: auto;
  `;
  document.body.appendChild(obsWin);
  
  const title = document.createElement('div');
  title.innerText = ">> AGENT LISTENING...";
  title.style.borderBottom = "1px solid #333";
  title.style.paddingBottom = "5px";
  obsWin.appendChild(title);
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
      }
    } catch (e) {
      console.error("Invalid JSON from Agent.", e);
    }
  }
}

function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;
  createObservationDeck(); // Ensure it exists
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
             const contextMsg = `\n\n[CORTEX MEMORY TRIGGERED: ${cleanHost}]\n${context}\n`;
             obsWin.innerText += contextMsg;
             obsWin.scrollTop = obsWin.scrollHeight;
             obsWin.style.borderLeftColor = "yellow";
             setTimeout(() => obsWin.style.borderLeftColor = "#333", 1000);
             knownDomainContexts.add(cleanHost);
           }
        });
      }
    } catch (e) {}
  }

  // --- UI UPDATE ---
  if (payload.type === "APPEND") {
    const currentText = obsWin.innerText.replace(/\n\n\[END UPDATE\]$/, "");
    obsWin.innerText = `${currentText}${payload.content}\n\n[END UPDATE]`;
    obsWin.scrollTop = obsWin.scrollHeight;
    obsWin.style.borderLeftColor = "#0f0";
    setTimeout(() => obsWin.style.borderLeftColor = "#333", 200);
  } else {
    obsWin.innerText = `[TARGET: ${sourceId}]\n\n${payload.content}\n\n[END UPDATE]`;
  }
}


// --- TARGET LOGIC ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
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
        payload: { type: "APPEND", content: `\n[ERROR]: Element ${cmd.id} missing.`, url: window.location.href }
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
  n.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:red;color:white;padding:5px;z-index:999999;";
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
