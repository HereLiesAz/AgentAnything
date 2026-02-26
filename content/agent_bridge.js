// content/agent_bridge.js

let attached = false;

function attach() {
  if (attached) return;
  chrome.runtime.sendMessage({ type: "ATTACH_DEBUGGER" });
  attached = true;
}

function detach() {
  if (!attached) return;
  chrome.runtime.sendMessage({ type: "DETACH_DEBUGGER" });
  attached = false;
}

chrome.runtime.onMessage.addListener((message) => {
  window.postMessage({
    source: "AgentAnything",
    ...message
  });
});

attach();
window.addEventListener("beforeunload", detach);
