// content/agent_bridge.js

let debuggerAttached = false;

function attach() {
  if (debuggerAttached) return;

  chrome.runtime.sendMessage({ type: "ATTACH_DEBUGGER" });
  debuggerAttached = true;
}

function detach() {
  if (!debuggerAttached) return;

  chrome.runtime.sendMessage({ type: "DETACH_DEBUGGER" });
  debuggerAttached = false;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "NETWORK_REQUEST") {
    window.postMessage({
      source: "AgentAnything",
      type: "NETWORK_REQUEST",
      payload: message.data
    });
  }

  if (message.type === "NETWORK_RESPONSE") {
    window.postMessage({
      source: "AgentAnything",
      type: "NETWORK_RESPONSE",
      payload: message.data
    });
  }
});

attach();

window.addEventListener("beforeunload", detach);
