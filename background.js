// background.js

const attachedTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ATTACH_DEBUGGER") {
    attachDebugger(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.type === "DETACH_DEBUGGER") {
    detachDebugger(sender.tab.id);
    sendResponse({ success: true });
  }
});

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);

    await chrome.debugger.sendCommand(
      { tabId },
      "Network.enable"
    );

    chrome.debugger.onEvent.addListener(handleDebuggerEvent);

    console.log("CDP attached to tab:", tabId);
  } catch (err) {
    console.error("Debugger attach failed:", err);
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    console.log("CDP detached from tab:", tabId);
  } catch (err) {
    console.error("Debugger detach failed:", err);
  }
}

function handleDebuggerEvent(source, method, params) {
  if (method === "Network.requestWillBeSent") {
    forwardToContent(source.tabId, {
      type: "NETWORK_REQUEST",
      data: params
    });
  }

  if (method === "Network.responseReceived") {
    forwardToContent(source.tabId, {
      type: "NETWORK_RESPONSE",
      data: params
    });
  }
}

function forwardToContent(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}
