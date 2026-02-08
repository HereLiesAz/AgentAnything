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

    // 1. GET LATEST TARGET (Synchronous-ish retrieval for Trap & Swap)
    if (message.action === "GET_LATEST_TARGET") {
        if (store.lastTargetPayload) {
            sendResponse({ 
                content: store.lastTargetPayload.content, 
                url: store.lastTargetPayload.url 
            });
        } else {
            sendResponse({ content: "NO TARGET CONNECTED", url: "N/A" });
        }
        return; // End execution for this branch
    }

    // 2. Reconnection Handshake
    if (message.action === "HELLO" && tabId) {
      if (tabId === store.agentTabId) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_AGENT" });
        // Note: In Trap & Swap, we don't auto-inject on reconnect. We wait for user input.
      } else if (targetTabIds.has(tabId)) {
        chrome.tabs.sendMessage(tabId, { action: "INIT_TARGET", tabId: tabId });
      }
      return;
    }

    // 3. Role Assignment
    if (message.action === "ASSIGN_ROLE") {
      if (message.role === "AGENT") {
        await chrome.storage.session.set({ agentTabId: message.tabId });
        targetTabIds.delete(message.tabId); 
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        console.log(`[System] Agent Assigned: ${message.tabId}`);
      } else {
        targetTabIds.add(message.tabId);
        await chrome.storage.session.set({ targetTabIds: Array.from(targetTabIds) });
        if (store.agentTabId === message.tabId) {
            await chrome.storage.session.set({ agentTabId: null });
        }
        console.log(`[System] Target Assigned: ${message.tabId}`);
      }
      return;
    }

    // 4. Agent Commands
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

    // 5. Target Updates
    if (message.action === "TARGET_UPDATE") {
      // Deduplication
      if (JSON.stringify(message.payload) === JSON.stringify(store.lastTargetPayload)) return; 

      await chrome.storage.session.set({ 
          lastTargetPayload: message.payload,
          lastTargetSourceId: tabId 
      });

      // We only notify the Agent if it's listening. 
      // In Trap & Swap, the Agent might be idle, but we send updates for the log.
      if (store.agentTabId) {
        chrome.tabs.sendMessage(store.agentTabId, {
          action: "INJECT_UPDATE",
          sourceId: tabId,
          payload: message.payload
        });
      }
    }

    // 6. DISENGAGE PROTOCOL
    if (message.action === "DISENGAGE_ALL") {
        console.log("[System] DISENGAGE PROTOCOL INITIATED");
        
        // Clear State
        await chrome.storage.session.clear();
        
        // Reload Agent
        if (store.agentTabId) {
             chrome.tabs.sendMessage(store.agentTabId, { action: "DISENGAGE_LOCAL" });
        }
        
        // Reload Targets
        targetTabIds.forEach(tId => {
            chrome.tabs.sendMessage(tId, { action: "DISENGAGE_LOCAL" });
        });
    }

  })();
  
  return true; // Keep message channel open for async sendResponse
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
