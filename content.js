chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.set({ agentTabId: null, targetTabIds: [], lastTargetPayload: null, lastTargetSourceId: null });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab ? sender.tab.id : null;
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds', 'lastTargetPayload', 'lastTargetSourceId']);
    const targetTabIds = new Set(store.targetTabIds || []);

    if (message.action === "GET_LATEST_TARGET") {
        sendResponse(store.lastTargetPayload);
        return;
    }

    if (message.action === "HELLO" && tabId) {
      if (tabId === store.agentTabId) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" }).catch(() => {});
      } else if (targetTabIds.has(tabId)) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET", tabId: tabId }).catch(() => {});
      }
      return;
    }

    if (message.action === "ASSIGN_ROLE") {
      if (message.role === "AGENT") {
        await chrome.storage.session.set({ agentTabId: message.tabId });
        targetTabIds.delete(message.tabId); 
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
      } else {
        targetTabIds.add(message.tabId);
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        if (store.agentTabId === message.tabId) await chrome.storage.session.set({ agentTabId: null });
      }
      return;
    }

    if (message.action === "AGENT_COMMAND") {
      const targetId = message.payload.targetTabId || store.lastTargetSourceId;
      if (!targetId) return;
      if (message.payload.tool === "browser") {
        handleBrowserAction(targetId, message.payload);
      } else {
        chrome.tabs.sendMessage(targetId, { action: "EXECUTE_COMMAND", command: message.payload }).catch(() => {});
      }
    }

    if (message.action === "TARGET_UPDATE") {
      if (JSON.stringify(message.payload) === JSON.stringify(store.lastTargetPayload)) return; 
      await chrome.storage.session.set({ lastTargetPayload: message.payload, lastTargetSourceId: tabId });
      if (store.agentTabId) {
        chrome.tabs.sendMessage(store.agentTabId, { action: "INJECT_UPDATE", sourceId: tabId, payload: message.payload }).catch(() => {});
      }
    }

    if (message.action === "DISENGAGE_ALL") {
        await chrome.storage.session.clear();
        if (store.agentTabId) chrome.tabs.sendMessage(store.agentTabId, { action: "DISENGAGE_LOCAL" }).catch(() => {});
        targetTabIds.forEach(tId => chrome.tabs.sendMessage(tId, { action: "DISENGAGE_LOCAL" }).catch(() => {}));
    }

  })();
  return true;
});

function handleBrowserAction(tabId, cmd) {
  switch (cmd.action) {
    case "refresh": chrome.tabs.reload(tabId); break;
    case "back": chrome.tabs.goBack(tabId); break;
    case "forward": chrome.tabs.goForward(tabId); break;
    case "close": chrome.tabs.remove(tabId); break;
    case "find": chrome.tabs.sendMessage(tabId, { action: "EXECUTE_COMMAND", command: cmd }).catch(() => {}); break;
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds']);
  if (store.agentTabId === tabId) await chrome.storage.session.set({ agentTabId: null });
  const targets = new Set(store.targetTabIds || []);
  if (targets.has(tabId)) {
      targets.delete(tabId);
      await chrome.storage.session.set({ targetTabIds: Array.from(targets) });
  }
});
