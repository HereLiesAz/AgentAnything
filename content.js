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
      if (role === "AGENT") injectObservation(msg.sourceId, msg.content);
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

  // Watch for AI output
  observeAIOutput();
}

function observeAIOutput() {
  // Brute force observer. 
  const observer = new MutationObserver((mutations) => {
    // Only parse if we see the closing code block, indicating completion
    const bodyText = document.body.innerText;
    if (bodyText.includes('```json') && bodyText.includes('```')) {
        parseCommands(bodyText);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

let lastCommandSignature = "";

function parseCommands(text) {
  // Regex to extract JSON blocks
  const regex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const sig = JSON.stringify(json);
      
      // Prevent loops: only execute if we haven't seen this exact command recently
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

function injectObservation(sourceId, content) {
  // Store the target ID so we know where to send commands
  window.activeTargetId = sourceId;

  // We need to feed this back to the AI.
  // Method: Create a floating, copyable status window.
  // Direct injection into third-party textareas is flaky (React/ShadowDOM blocking).
  
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

  obsWin.innerText = `[UPDATE FROM TAB ${sourceId}]\n\n${content}\n\n[END UPDATE]`;
  
  // Flash effect
  obsWin.style.backgroundColor = "#111";
  setTimeout(() => obsWin.style.backgroundColor = "#000", 100);
}

// --- TARGET LOGIC (The Tool) ---

function initTargetLogic() {
  console.log("%c TARGET ACQUIRED ", "background: #000; color: #f00; font-size: 20px;");
  
  // 1. Map the page
  const map = Heuristics.generateMap();
  targetMap = map; // Cache it
  
  // 2. Identify Content Area for observation
  const contentNode = Heuristics.findMainContent();
  
  // 3. Build the Schema for the Agent
  const toolSchema = map.map(item => {
    return `ID: "${item.id}" | Type: ${item.tag} | Text: "${item.text}" | Score: ${item.score.toFixed(1)}`;
  }).join('\n');

  const fullReport = `
TARGET CONNECTED: ${document.title}
URL: ${window.location.href}

AVAILABLE INTERFACE ELEMENTS (Sorted by Relevance):
---------------------------------------------------
${toolSchema}
---------------------------------------------------
INSTRUCTIONS:
To search or chat, look for 'input' or 'textarea' with high scores.
To submit, look for 'button' with text like 'search' or 'send'.
  `;

  // Send initial state
  chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: fullReport });

  // 4. Set up observers on the CONTENT NODE only (Performance)
  const observer = new MutationObserver(() => {
    // Debounce updates
    if (window.debounceUpdate) clearTimeout(window.debounceUpdate);
    window.debounceUpdate = setTimeout(() => {
        // We only send back the text content of the main area
        // to avoid overwhelming the Agent's context window.
        const freshContent = contentNode.innerText.substring(0, 2000); // Token limit protection
        chrome.runtime.sendMessage({ 
            action: "TARGET_UPDATE", 
            payload: `[ASYNC PAGE UPDATE]:\n${freshContent}...` 
        });
    }, 1500);
  });
  
  observer.observe(contentNode, { childList: true, subtree: true, characterData: true });
}

function executeCommand(cmd) {
  // Find element by the ID we assigned
  const item = targetMap.find(i => i.id === cmd.id);
  const el = document.querySelector(`[data-aa-id="${cmd.id}"]`); // Re-query to be safe

  if (!el) {
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: "ERROR: Element not found. DOM may have shifted." });
    // Trigger re-map?
    return;
  }

  // Highlight action
  const originalBorder = el.style.border;
  el.style.border = "2px solid #0f0";
  setTimeout(() => el.style.border = originalBorder, 500);

  try {
    if (cmd.action === "click") {
      el.click();
      // Also try sending Enter key if it's a button, sometimes click is intercepted
      el.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Enter'}));
    } 
    else if (cmd.action === "type") {
      el.value = cmd.value;
      el.innerText = cmd.value; // Fallback
      // React/Angular State Hack:
      // These frameworks track value in internal state, not just DOM.
      // We must trigger input events.
      const event = new Event('input', { bubbles: true });
      el.dispatchEvent(event);
      const change = new Event('change', { bubbles: true });
      el.dispatchEvent(change);
    }
    else if (cmd.action === "read") {
        // Handled by default update, but specific read can be useful
    }
  } catch (err) {
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: `ERROR EXECUTING ${cmd.action}: ${err.message}` });
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
        // Fallback for non-secure contexts
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}
