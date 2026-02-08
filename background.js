let agentTab = null;
let activeTargets = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.action === "ASSIGN_ROLE") {
    if (message.role === "AGENT") {
      agentTab = message.tabId;
      console.log(`Agent assigned: ${agentTab}`);
    } else {
      activeTargets.add(message.tabId);
      console.log(`Target acquired: ${message.tabId}`);
    }
    return;
  }

  if (message.action === "AGENT_COMMAND") {
    // message.payload should contain { targetTabId, ...cmd }
    // If targetTabId is missing, broadcast to all (chaos mode)
    if (message.payload.targetTabId) {
      chrome.tabs.sendMessage(message.payload.targetTabId, {
        action: "EXECUTE_COMMAND",
        command: message.payload
      });
    } else {
        // Broadcast to first available target if unspecified
        const firstTarget = activeTargets.values().next().value;
        if (firstTarget) {
             chrome.tabs.sendMessage(firstTarget, {
                action: "EXECUTE_COMMAND",
                command: message.payload
            });
        }
    }
  }

  if (message.action === "TARGET_UPDATE") {
    if (agentTab) {
      chrome.tabs.sendMessage(agentTab, {
        action: "INJECT_OBSERVATION",
        sourceId: tabId,
        content: message.payload
      });
    }
  }
});

// Clean up if tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (agentTab === tabId) agentTab = null;
  activeTargets.delete(tabId);
});
