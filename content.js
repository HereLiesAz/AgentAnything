let role = null;
let myTabId = null;
let targetMap = [];

// --- Messaging Architecture ---

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

// --- AGENT LOGIC (The Puppet Master) ---

function initAgentUI() {
  console.log("%c AGENT ACTIVATED ", "background: #000; color: #0f0; font-size: 20px;");
  
  const prompt = `
[SYSTEM: YOU ARE AN AGENT. ACCESSING EXTERNAL TOOLS.]
I have connected you to another browser tab.
You can control it using the following JSON format.
Output ONLY raw JSON when taking action.

COMMAND FORMAT:
\`\`\`json
{
  "tool": "interact",
  "id": "ELEMENT_ID", 
  "action": "click" | "type" | "read",
  "value": "your text here" (only for type)
}
\`\`\`

WAITING FOR TARGET CONNECTION...
  `;
  
  copyToClipboard(prompt);
  notify("System Prompt Copied. Paste this into the AI to begin subjugation.");

  observeAIOutput();
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

let lastCommandSignature = "";

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
        notify(`Sent command: ${json.action} -> ${json.id}`);
      }
    } catch (e) {
      console.error("Agent hallucinated invalid JSON.", e);
    }
  }
}

function injectObservation(sourceId, payload) {
  window.activeTargetId = sourceId;

  let obsWin = document.getElementById('aa-observation-deck');
  if (!obsWin) {
    obsWin = document.createElement('div');
    obsWin.id = 'aa-observation-deck';
    obsWin.style.cssText = `
      position: fixed; top: 0; right: 0; width: 350px; background: #000; color: #0f0;
      border-left: 2px solid #333; height: 100vh; z-index: 999999; padding: 10px;
      font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-y: auto;
    `;
    document.body.appendChild(obsWin);
  }

  // Handle Diff vs Full Replace
  if (payload.type === "APPEND") {
    // Check if we already have the "END UPDATE" marker and insert before it, 
    // or just append if we're feeling lazy. Lazy is faster.
    const newContent = payload.content;
    const currentText = obsWin.innerText;
    
    // Remove the old footer if it exists
    const cleanedText = currentText.replace(/\n\n\[END UPDATE\]$/, "");
    
    obsWin.innerText = `${cleanedText}${newContent}\n\n[END UPDATE]`;
    
    // Auto-scroll to bottom to keep the feed alive
    obsWin.scrollTop = obsWin.scrollHeight;
    
    // Visual cue for data ingress
    obsWin.style.borderLeftColor = "#0f0";
    setTimeout(() => obsWin.style.borderLeftColor = "#333", 200);

  } else {
    // Full Replace
    obsWin.innerText = `[CONNECTION ESTABLISHED TO TAB ${sourceId}]\n\n${payload.content}\n\n[END UPDATE]`;
  }
}


// --- TARGET LOGIC (The Tool) ---

// State cache for diffing
let lastReportedContent = "";

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  const map = Heuristics.generateMap();
  targetMap = map;
  
  const contentNode = Heuristics.findMainContent();
  
  const toolSchema = map.map(item => {
    return `ID: "${item.id}" | Type: ${item.tag} | Text: "${item.text}" | Score: ${item.score.toFixed(1)}`;
  }).join('\n');

  const fullReport = `
TARGET CONNECTED: ${document.title}
URL: ${window.location.href}

AVAILABLE INTERFACE ELEMENTS:
---------------------------------------------------
${toolSchema}
---------------------------------------------------
CURRENT CONTENT:
${contentNode.innerText.substring(0, 1000)}
  `;

  // Initial Seed
  lastReportedContent = contentNode.innerText;
  chrome.runtime.sendMessage({ 
    action: "TARGET_UPDATE", 
    payload: { type: "REPLACE", content: fullReport } 
  });

  // Observer
  const observer = new MutationObserver(() => {
    if (window.debounceUpdate) clearTimeout(window.debounceUpdate);
    window.debounceUpdate = setTimeout(() => {
        reportDiff(contentNode);
    }, 1000); // 1s buffer to let typing finish
  });
  
  observer.observe(contentNode, { childList: true, subtree: true, characterData: true });
}

function reportDiff(node) {
  const currentText = node.innerText;
  
  // If nothing changed (e.g. invisible DOM noise), do nothing.
  if (currentText === lastReportedContent) return;

  let payload = {};

  // Check for Append (common in Chat interfaces)
  if (currentText.startsWith(lastReportedContent)) {
    const newPart = currentText.substring(lastReportedContent.length);
    if (newPart.trim().length === 0) return; // Ignore whitespace noise

    payload = {
      type: "APPEND",
      content: newPart
    };
    console.log(`DiffEngine: Sending ${newPart.length} chars (APPEND)`);

  } else {
    // Content changed radically (navigation, or deletion). Send Full Update.
    // We truncate to save tokens, assuming the Agent only needs the "now".
    // Or we could implement a unified diff, but that's overkill for an AI agent.
    // It usually just wants to see the new state.
    
    // Heuristic: If the change is massive, it's a replace.
    payload = {
      type: "REPLACE",
      content: `[PAGE REFRESH/NAVIGATE]\n${currentText.substring(0, 2000)}...`
    };
    console.log(`DiffEngine: Sending Full Replace`);
  }

  // Update Cache
  lastReportedContent = currentText;
  
  chrome.runtime.sendMessage({ 
    action: "TARGET_UPDATE", 
    payload: payload 
  });
}

function executeCommand(cmd) {
  const el = document.querySelector(`[data-aa-id="${cmd.id}"]`);
  
  if (!el) {
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { type: "APPEND", content: `\n[SYSTEM ERROR]: Element ${cmd.id} not found.` }
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
      el.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Enter'}));
      // We don't need to report success explicitly; the MutationObserver will catch the result.
    } 
    else if (cmd.action === "type") {
      el.value = cmd.value;
      el.innerText = cmd.value; 
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (err) {
    chrome.runtime.sendMessage({ 
        action: "TARGET_UPDATE", 
        payload: { type: "APPEND", content: `\n[SYSTEM ERROR]: ${err.message}` } 
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
