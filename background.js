// The puppet master, pulling strings it cannot see.

let agentTabId = null;
let targetTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ASSIGN_ROLE") {
    handleRoleAssignment(message.role, message.tabId);
    sendResponse({ status: "Role assigned. The die is cast." });
  } else if (message.action === "AGENT_COMMAND") {
    console.log(`Command received from Agent ${sender.tab.id}:`, message.payload);
    dispatchCommandToTargets(message.payload);
  } else if (message.action === "TARGET_UPDATE") {
    console.log(`Update from Target ${sender.tab.id}. Feeding the beast.`);
    relayUpdateToAgent(sender.tab.id, message.payload);
  }
  return true; 
});

function handleRoleAssignment(role, tabId) {
  if (role === "AGENT") {
    if (agentTabId && agentTabId !== tabId) {
      // There can be only one Highlander.
      chrome.tabs.sendMessage(agentTabId, { action: "DEMOTED" });
    }
    agentTabId = tabId;
    targetTabs.delete(tabId); // An agent cannot inspect itself without going mad.
    console.log(`Tab ${tabId} is now the Agent.`);
  } else if (role === "TARGET") {
    if (agentTabId === tabId) {
      agentTabId = null;
    }
    targetTabs.add(tabId);
    console.log(`Tab ${tabId} is now a Target. Poor thing.`);
  }
}

function dispatchCommandToTargets(commandData) {
  // commandData: { targetTabId: number, command: string, selector: string, value: string }
  if (!commandData.targetTabId) return;

  const targetId = parseInt(commandData.targetTabId);
  if (targetTabs.has(targetId)) {
    chrome.tabs.sendMessage(targetId, {
      action: "EXECUTE_COMMAND",
      command: commandData
    });
  }
}

function relayUpdateToAgent(sourceTabId, content) {
  if (agentTabId) {
    chrome.tabs.sendMessage(agentTabId, {
      action: "INJECT_OBSERVATION",
      sourceId: sourceTabId,
      content: content
    });
  }
}
