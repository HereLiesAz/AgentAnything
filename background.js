// STATE MANAGEMENT
let agentTabId = null;
let targetTabIds = new Set();
// The Mailbox: Stores the last known state of the active target to feed new agents
let lastTargetPayload = null;
let lastTargetId = null;

// --- EVENT LISTENERS ---

// 1. THE HANDSHAKE (Auto-Reconnect)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  // A tab has loaded and is asking "Who am I?"
  if (message.action === "HELLO" && tabId) {
    if (tabId === agentTabId) {
      console.log(`Restoring AGENT: ${tabId}`);
      chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
      // If we have a target waiting, deliver it immediately
      if (lastTargetPayload && lastTargetId) {
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {
            action: "INJECT_OBSERVATION",
            sourceId: lastTargetId,
            payload: lastTargetPayload
          });
        }, 500);
      }
    } else if (targetTabIds.has(tabId)) {
      console.log(`Restoring TARGET: ${tabId}`);
      chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET", tabId: tabId });
    }
    return;
  }

  // 2. ROLE ASSIGNMENT (User Clicked Button)
  if (message.action === "ASSIGN_ROLE") {
    if (message.role === "AGENT") {
      agentTabId = message.tabId;
      targetTabIds.delete(message.tabId); // Can't be both
      console.log(`Agent assigned: ${agentTabId}`);
      
      // Immediate delivery of cached target
      if (lastTargetPayload && lastTargetId) {
        chrome.tabs.sendMessage(agentTabId, {
          action: "INJECT_OBSERVATION",
          sourceId: lastTargetId,
          payload: lastTargetPayload
        });
      }
    } else {
      targetTabIds.add(message.tabId);
      if (agentTabId === message.tabId) agentTabId = null;
      console.log(`Target acquired: ${message.tabId}`);
    }
    return;
  }

  // 3. AGENT COMMANDS
  if (message.action === "AGENT_COMMAND") {
    const targetId = message.payload.targetTabId || lastTargetId;
    if (!targetId) return;

    if (message.payload.tool === "browser") {
      handleBrowserAction(targetId, message.payload);
    } else {
      chrome.tabs.sendMessage(targetId, {
        action: "EXECUTE_COMMAND",
        command: message.payload
      });
    }
  }

  // 4. TARGET UPDATES
  if (message.action === "TARGET_UPDATE") {
    lastTargetPayload = message.payload;
    lastTargetId = tabId;

    if (agentTabId) {
      chrome.tabs.sendMessage(agentTabId, {
        action: "INJECT_OBSERVATION",
        sourceId: tabId,
        payload: message.payload
      });
    }
  }
});

// --- BROWSER CONTROL ---
function handleBrowserAction(tabId, cmd) {
  switch (cmd.action) {
    case "refresh":
      chrome.tabs.reload(tabId);
      break;
    case "back":
      chrome.tabs.goBack(tabId);
      break;
    case "forward":
      chrome.tabs.goForward(tabId);
      break;
    case "close":
      chrome.tabs.remove(tabId);
      break;
    case "find":
        chrome.tabs.sendMessage(tabId, {
            action: "EXECUTE_COMMAND",
            command: cmd
        });
        break;
  }
}

// --- CLEANUP ---
chrome.tabs.onRemoved.addListener((tabId) => {
  if (agentTabId === tabId) agentTabId = null;
  targetTabIds.delete(tabId);
  if (lastTargetId === tabId) {
      lastTargetId = null;
      lastTargetPayload = null;
  }
});
