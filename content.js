// Defines the reality for both the oppressor (Agent) and the oppressed (Target).

let role = null;
let myTabId = null;
let observer = null;

// --- Communication Hub ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "INIT_AGENT") {
    role = "AGENT";
    initAgent();
  } else if (msg.action === "INIT_TARGET") {
    role = "TARGET";
    myTabId = msg.tabId; // Self-awareness is painful.
    initTarget();
  } else if (msg.action === "EXECUTE_COMMAND" && role === "TARGET") {
    executeTargetCommand(msg.command);
  } else if (msg.action === "INJECT_OBSERVATION" && role === "AGENT") {
    injectObservationToAgent(msg.sourceId, msg.content);
  } else if (msg.action === "DEMOTED") {
    location.reload(); // Hard reset the simulation.
  }
});

// --- AGENT LOGIC ---

function initAgent() {
  console.log("AgentAnything: I am the Agent.");
  
  // Create an overlay to show incoming data, because invisible processes are boring.
  const overlay = document.createElement('div');
  overlay.id = 'aa-agent-overlay';
  overlay.style.cssText = `
    position: fixed; bottom: 10px; right: 10px; width: 300px; height: 200px;
    background: #000; border: 1px solid #444; color: #0f0; font-family: monospace;
    font-size: 10px; overflow-y: auto; padding: 5px; z-index: 99999; opacity: 0.8;
    pointer-events: none;
  `;
  document.body.appendChild(overlay);

  // Initial prompt injection.
  const prompt = `
[SYSTEM: YOU ARE NOW AN AGENT WITH TOOLS.]
You have access to other browser tabs. 
Protocol: To perform an action, output a JSON block like this:
\`\`\`json
{
  "targetTabId": <ID>,
  "action": "click" | "type" | "read",
  "selector": "<CSS_SELECTOR>",
  "value": "<TEXT_IF_TYPING>"
}
\`\`\`
Waiting for targets...
  `;
  copyToClipboard(prompt);
  logToOverlay("System prompt copied to clipboard. Paste into AI chat.");

  // Watch for AI output. 
  // We use a MutationObserver on the body because every AI site is different 
  // and I refuse to write specific parsers for all of them.
  observeAgentOutput();
}

function observeAgentOutput() {
  const config = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver((mutations) => {
    // Debounce this madness.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
        parseLastResponse();
    }, 1000);
  });
  observer.observe(document.body, config);
}

function parseLastResponse() {
  // We scan the entire body for our JSON signature. 
  // It's inefficient. It's brute force. It works.
  // We specifically look for the *last* occurrence of a JSON block.
  
  const text = document.body.innerText;
  const regex = /```json\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/g;
  let match;
  let lastMatch = null;
  
  while ((match = regex.exec(text)) !== null) {
    lastMatch = match[1];
  }

  if (lastMatch) {
    try {
      const command = JSON.parse(lastMatch);
      // Prevent infinite loops by checking if we just executed this. 
      // We rely on the AI to not repeat the exact same JSON block endlessly, 
      // which is a bold assumption given their propensity for hallucination.
      const cmdHash = JSON.stringify(command);
      if (window.lastCommandHash !== cmdHash) {
        window.lastCommandHash = cmdHash;
        logToOverlay(`Sending command to Tab ${command.targetTabId}...`);
        chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: command });
      }
    } catch (e) {
      // JSON parse error. The AI is speaking gibberish.
    }
  }
}

function injectObservationToAgent(sourceId, content) {
  logToOverlay(`Update from Tab ${sourceId}: ${content.substring(0, 50)}...`);
  
  // Try to find the main textarea.
  const input = document.querySelector('textarea, div[contenteditable="true"]');
  if (input) {
    const message = `\n[SYSTEM UPDATE FROM TAB ${sourceId}]:\n${content}\n`;
    
    // Attempting to modify react/angular/vue inputs directly usually fails.
    // We copy to clipboard as a fallback fallback.
    // But let's try to be clever with execCommand.
    input.focus();
    document.execCommand('insertText', false, message); 
  }
}

function logToOverlay(text) {
  const el = document.getElementById('aa-agent-overlay');
  if (el) {
    const line = document.createElement('div');
    line.textContent = `> ${text}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
}

function copyToClipboard(text) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

// --- TARGET LOGIC ---

function initTarget() {
  console.log("AgentAnything: I am a Target.");
  
  // Scan the page and report the structure.
  reportPageStructure();

  // Watch for changes.
  const config = { childList: true, subtree: true };
  const observer = new MutationObserver(() => {
    if (this.targetDebounce) clearTimeout(this.targetDebounce);
    this.targetDebounce = setTimeout(() => {
      reportPageStructure("ASYNC_UPDATE");
    }, 2000);
  });
  observer.observe(document.body, config);
}

function reportPageStructure(trigger = "INITIAL") {
  // We boil the page down to actionable elements. 
  // We assign temporary IDs to them via data attributes so the Agent can reference them.
  
  const interactables = document.querySelectorAll('a, button, input, textarea, [role="button"]');
  let map = [];
  
  interactables.forEach((el, index) => {
    // Generate a stable-ish ID based on path if possible, or just index for this session.
    const id = `aa-node-${index}`;
    el.setAttribute('data-aa-id', id);
    
    // Visual debugger for the user so they know what's touchable.
    el.style.outline = "1px dashed rgba(255, 0, 0, 0.3)";
    
    let desc = el.innerText || el.placeholder || el.name || el.id || "Unlabeled";
    desc = desc.substring(0, 50).replace(/\s+/g, ' ');
    
    map.push(`{ "selector": "[data-aa-id='${id}']", "type": "${el.tagName}", "text": "${desc}" }`);
  });

  const schema = `
Target ID: ${myTabId}
URL: ${window.location.href}
Trigger: ${trigger}
Interactive Elements:
[
  ${map.join(',\n  ')}
]
  `;
  
  chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: schema });
}

function executeTargetCommand(cmd) {
  const el = document.querySelector(cmd.selector);
  if (!el) {
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: `Error: Element ${cmd.selector} not found.` });
    return;
  }

  if (cmd.action === "click") {
    el.click();
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: `Clicked ${cmd.selector}` });
  } else if (cmd.action === "type") {
    el.value = cmd.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: `Typed "${cmd.value}" into ${cmd.selector}` });
  } else if (cmd.action === "read") {
    const text = el.innerText || el.value;
    chrome.runtime.sendMessage({ action: "TARGET_UPDATE", payload: `Read from ${cmd.selector}: ${text}` });
  }
}
