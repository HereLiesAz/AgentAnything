// STATE MANAGEMENT
// Uses chrome.storage.session to maintain state across Service Worker restarts.

// --- INITIALIZATION ---
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[System] Extension installed. Initializing...");
  
  await chrome.storage.session.set({ 
      agentTabId: null, 
      targetTabIds: [], 
      lastTargetPayload: null, 
      lastTargetSourceId: null 
  });
  
  const manifest = chrome.runtime.getManifest();
  
  for (const cs of manifest.content_scripts) {
    const tabs = await chrome.tabs.query({url: cs.matches});
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("view-source:")) {
        continue;
      }
      try {
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          files: cs.js,
        });
        console.log(`[System] Script injected: ${tab.id}`);
      } catch (e) {
        console.warn(`[System] Injection failed for ${tab.id}: ${e.message}`);
      }
    }
  }
});

// --- MESSAGE ROUTING ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab ? sender.tab.id : null;
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds', 'lastTargetPayload', 'lastTargetSourceId']);
    const targetTabIds = new Set(store.targetTabIds || []);

    // Reconnection Handshake
    if (message.action === "HELLO" && tabId) {
      if (tabId === store.agentTabId) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
        if (store.lastTargetPayload && store.lastTargetSourceId) {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              action: "INJECT_UPDATE",
              sourceId: store.lastTargetSourceId,
              payload: store.lastTargetPayload
            });
          }, 500);
        }
      } else if (targetTabIds.has(tabId)) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET", tabId: tabId });
      }
      return;
    }

    // Role Assignment
    if (message.action === "ASSIGN_ROLE") {
      if (message.role === "AGENT") {
        await chrome.storage.session.set({ agentTabId: message.tabId });
        targetTabIds.delete(message.tabId); 
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        
        if (store.lastTargetPayload && store.lastTargetSourceId) {
          chrome.tabs.sendMessage(message.tabId, {
            action: "INJECT_UPDATE",
            sourceId: store.lastTargetSourceId,
            payload: store.lastTargetPayload
          });
        }
      } else {
        targetTabIds.add(message.tabId);
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        
        if (store.agentTabId === message.tabId) {
            await chrome.storage.session.set({ agentTabId: null });
        }
      }
      return;
    }

    // Agent Commands
    if (message.action === "AGENT_COMMAND") {
      const targetId = message.payload.targetTabId || store.lastTargetSourceId;
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

    // Target Updates
    if (message.action === "TARGET_UPDATE") {
      const newPayloadStr = JSON.stringify(message.payload);
      const oldPayloadStr = JSON.stringify(store.lastTargetPayload);

      if (newPayloadStr === oldPayloadStr) return; 

      await chrome.storage.session.set({ 
          lastTargetPayload: message.payload,
          lastTargetSourceId: tabId 
      });

      if (store.agentTabId) {
        chrome.tabs.sendMessage(store.agentTabId, {
          action: "INJECT_UPDATE",
          sourceId: tabId,
          payload: message.payload
        });
      }
    }
  })();
  
  return true;
});

// --- BROWSER ACTIONS ---
function handleBrowserAction(tabId, cmd) {
  switch (cmd.action) {
    case "refresh": chrome.tabs.reload(tabId); break;
    case "back": chrome.tabs.goBack(tabId); break;
    case "forward": chrome.tabs.goForward(tabId); break;
    case "close": chrome.tabs.remove(tabId); break;
    case "find":
        chrome.tabs.sendMessage(tabId, {
            action: "EXECUTE_COMMAND",
            command: cmd
        });
        break;
  }
}

// --- CLEANUP ---
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds', 'lastTargetSourceId']);
  
  if (store.agentTabId === tabId) {
      await chrome.storage.session.set({ agentTabId: null });
  }
  
  const targets = new Set(store.targetTabIds || []);
  if (targets.has(tabId)) {
      targets.delete(tabId);
      await chrome.storage.session.set({ targetTabIds: Array.from(targets) });
  }
  
  if (store.lastTargetSourceId === tabId) {
      await chrome.storage.session.set({ 
          lastTargetSourceId: null,
          lastTargetPayload: null 
      });
  }
});
