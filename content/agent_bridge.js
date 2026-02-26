// AgentAnything Bridge (Content Script)

let networkAttached = false;

function attachNetwork() {
  if (networkAttached) return;
  chrome.runtime.sendMessage({ type: "AA_ATTACH_NETWORK" });
  networkAttached = true;
}

function detachNetwork() {
  if (!networkAttached) return;
  chrome.runtime.sendMessage({ type: "AA_DETACH_NETWORK" });
  networkAttached = false;
}

chrome.runtime.onMessage.addListener((message) => {

  if (message.type === "AA_NETWORK_REQUEST" ||
      message.type === "AA_NETWORK_BODY") {

    window.postMessage({
      source: "AA_CDP",
      ...message
    }, window.location.origin);
  }

});

attachNetwork();
window.addEventListener("beforeunload", detachNetwork);
