// STATE MANAGEMENT
let agentTabId = null;
let targetTabIds = new Set();
// The Mailbox: Stores the last known state of the active target
let lastTargetPayload = null;
let lastTargetId = null;

// --- 0. THE WAKE UP CALL (AUTO-INJECTION ON INSTALL) ---
chrome.runtime.onInstalled.addListener(async () => {
  console.log("AgentAnything Installed. Waking up all tabs...");
  
  const manifest = chrome.runtime.getManifest();
  
  // We iterate through every content script definition in the manifest
  for (const cs of manifest.content_scripts) {
    // We find all tabs that match the content script patterns
    // Note: This relies on the new host_permissions in manifest
    const tabs = await chrome.tabs.query({url: cs.matches});
    
    for (const tab of tabs) {
      // Skip internal browser pages where we definitely can't inject
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("view-source:")) {
        continue;
      }
      
      try {
        // We MUST await this to catch errors (like 'Cannot access contents of url')
        // within this specific try/catch block.
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          files: cs.js,
        });
        console.log(`Injected scripts into existing tab: ${tab.id} (${tab.url})`);
      } catch (e) {
        // This catches the error you saw, logs it, and allows the loop to continue
        // to the next tab without crashing the extension.
        console.warn(`Could not inject into tab ${tab.id}: ${e.message}`);
      }
    }
  }
});

// --- 1. THE HANDSHAKE (Auto-Reconnect) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  // A tab has loaded/reloaded and is asking "Who am I?"
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

  // --- 2. ROLE ASSIGNMENT (User Clicked Button) ---
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

  // --- 3. AGENT COMMANDS ---
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

  // --- 4. TARGET UPDATES ---
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
