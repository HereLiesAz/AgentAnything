// hereliesaz/agentanything/AgentAnything-05c5b6fc4348e667e2769e1a2345ae1bf3bde566/background.js

// --- 0. THE WAKE UP CALL (AUTO-INJECTION ON INSTALL) ---
chrome.runtime.onInstalled.addListener(async () => {
  console.log("AgentAnything Installed. Waking up all tabs...");
  await chrome.storage.session.set({ 
      agentTabId: null, 
      targetTabIds: [], // Storage API stores arrays, not Sets
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
        console.log(`Injected scripts into existing tab: ${tab.id} (${tab.url})`);
      } catch (e) {
        console.warn(`Could not inject into tab ${tab.id}: ${e.message}`);
      }
    }
  }
});

// --- 1. THE HANDSHAKE (Auto-Reconnect) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // We must return true to indicate we will respond asynchronously (if needed),
  // though we mostly use fire-and-forget messaging here.
  (async () => {
    const tabId = sender.tab ? sender.tab.id : null;
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds', 'lastTargetPayload', 'lastTargetSourceId']);
    const targetTabIds = new Set(store.targetTabIds || []);

    // A tab has loaded/reloaded and is asking "Who am I?"
    if (message.action === "HELLO" && tabId) {
      if (tabId === store.agentTabId) {
        console.log(`Restoring AGENT: ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
        // Immediate delivery of cached target
        if (store.lastTargetPayload && store.lastTargetSourceId) {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              action: "INJECT_OBSERVATION",
              sourceId: store.lastTargetSourceId,
              payload: store.lastTargetPayload
            });
          }, 500);
        }
      } else if (targetTabIds.has(tabId)) {
        console.log(`Restoring TARGET: ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET", tabId: tabId });
      }
      return;
    }

    // --- 2. ROLE ASSIGNMENT (User Clicked Button) ---
    if (message.action === "ASSIGN_ROLE") {
      if (message.role === "AGENT") {
        await chrome.storage.session.set({ agentTabId: message.tabId });
        targetTabIds.delete(message.tabId); 
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        
        console.log(`Agent assigned: ${message.tabId}`);
        
        if (store.lastTargetPayload && store.lastTargetSourceId) {
          chrome.tabs.sendMessage(message.tabId, {
            action: "INJECT_OBSERVATION",
            sourceId: store.lastTargetSourceId,
            payload: store.lastTargetPayload
          });
        }
      } else {
        targetTabIds.add(message.tabId);
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        
        // If this tab was the agent, clear it
        if (store.agentTabId === message.tabId) {
             await chrome.storage.session.set({ agentTabId: null });
        }
        console.log(`Target acquired: ${message.tabId}`);
      }
      return;
    }

    // --- 3. AGENT COMMANDS ---
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

    // --- 4. TARGET UPDATES (With Deduplication) ---
    if (message.action === "TARGET_UPDATE") {
      // Deduplication: If payload is identical to last stored, ignore.
      // We use a simple JSON string comparison.
      const newPayloadStr = JSON.stringify(message.payload);
      const oldPayloadStr = JSON.stringify(store.lastTargetPayload);

      if (newPayloadStr === oldPayloadStr) {
          // console.log("Skipping duplicate payload from target.");
          return; 
      }

      await chrome.storage.session.set({ 
          lastTargetPayload: message.payload,
          lastTargetSourceId: tabId 
      });

      if (store.agentTabId) {
        chrome.tabs.sendMessage(store.agentTabId, {
          action: "INJECT_OBSERVATION",
          sourceId: tabId,
          payload: message.payload
        });
      }
    }
  })();
  return true; // Keep channel open for async
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
