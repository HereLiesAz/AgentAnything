let role = null;
let myTabId = null;
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
    case "REMOTE_INJECT":
      if (role === "AGENT") {
          console.log("[System] Received Remote Command");
          handleRemoteCommand(msg.payload);
      }
      break;
    case "DISENGAGE_LOCAL":
      window.location.reload();
      break;
  }
});

// --- AGENT LOGIC ---

function initAgent() {
  console.log("[System] Agent Armed. Trap Active.");
  showStatusBadge("AGENT ARMED: Type in chat OR use Popup");
  armAgentTrap();
  observeAgentOutput();
}

// 1. THE TRAP (Local Interaction)
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
            
            const userText = target.value || target.innerText || "";
            executeInjectionSequence(target, null, userText); 
        }
    }
}

function handleClickTrap(e) {
    const target = e.target.closest('button, [role="button"], input[type="submit"], [data-testid*="send"], svg');
    if (target) {
        const input = Heuristics.findBestInput(); 
        if (input && (input.value || input.innerText)) {
            console.log("[System] Trap Triggered by CLICK");
            e.preventDefault();
            e.stopPropagation();
            
            const userText = input.value || input.innerText || "";
            executeInjectionSequence(input, target, userText);
        }
    }
}

// 2. THE SIDECAR (Popup Interaction)
function handleRemoteCommand(text) {
    const input = Heuristics.findBestInput();
    if (input) {
        executeInjectionSequence(input, null, text);
    } else {
        console.error("AgentAnything: Could not find input box for remote command.");
    }
}

// 3. THE EXECUTION ENGINE (Shared)
async function executeInjectionSequence(inputElement, buttonElement, userText) {
    // A. LOCK DOWN
    window.removeEventListener('keydown', handleKeyTrap, true);
    window.removeEventListener('click', handleClickTrap, true);
    enableInputGuard(); 
    showStatusBadge("PREPARING PAYLOAD...");

    // B. FETCH CONTEXT
    const response = await chrome.runtime.sendMessage({ action: "GET_LATEST_TARGET" });
    const targetData = response
