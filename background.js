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
    const targetId = message.payload.targetTabId || activeTargets.values().next().value;
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

  if (message.action === "TARGET_UPDATE") {
    if (agentTab) {
      chrome.tabs.sendMessage(agentTab, {
        action: "INJECT_OBSERVATION",
        sourceId: tabId,
        payload: message.payload // Note: updated to pass 'payload' object
      });
    }
  }
});

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

chrome.tabs.onRemoved.addListener((tabId) => {
  if (agentTab === tabId) agentTab = null;
  activeTargets.delete(tabId);
});
