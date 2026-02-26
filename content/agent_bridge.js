// content/agent_bridge.js

(function () {
chrome.tabs.onRemoved.addListener((tabId) => {
  if (AA_DEBUG_SESSIONS.has(tabId)) {
    try {
      chrome.debugger.detach({ tabId });
    } catch (_) {}
    AA_DEBUG_SESSIONS.delete(tabId);
  }
});
  if (window.__AA_BRIDGE__) return;
  window.__AA_BRIDGE__ = true;

  let networkAttached = false;

  function safeSend(message) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (_) {}
  }

  function attachNetwork() {
    if (networkAttached) return;
    safeSend({ type: "AA_ATTACH_NETWORK" });
    networkAttached = true;
  }

  function detachNetwork() {
    if (!networkAttached) return;
    safeSend({ type: "AA_DETACH_NETWORK" });
    networkAttached = false;
  }

  chrome.runtime.onMessage.addListener((message) => {

    if (
      message.type === "AA_NETWORK_REQUEST" ||
      message.type === "AA_NETWORK_BODY"
    ) {
      window.postMessage(
        {
          source: "AA_CDP",
          ...message
        },
        window.location.origin
      );
    }

  });

  // Attach when loaded
  attachNetwork();

  // DO NOT use beforeunload
  // It causes context invalidation errors
})();

