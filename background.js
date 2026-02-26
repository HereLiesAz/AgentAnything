// =============================
// NETWORK CDP LAYER (AgentAnything)
// =============================

const AA_DEBUG_SESSIONS = new Map();
// tabId -> { requestMap: Map }

const AA_FILTERS = {
  enabled: true,
  urlIncludes: [],
  urlRegex: null,
  methods: [],
  resourceTypes: [],
  captureBodies: false
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message.type === "AA_ATTACH_NETWORK") {
    attachNetwork(tabId);
    sendResponse({ success: true });
  }

  if (message.type === "AA_DETACH_NETWORK") {
    detachNetwork(tabId);
    sendResponse({ success: true });
  }

  if (message.type === "AA_SET_NETWORK_FILTERS") {
    updateNetworkFilters(message.filters || {});
    sendResponse({ success: true });
  }
});

function updateNetworkFilters(filters) {
  AA_FILTERS.enabled = filters.enabled ?? true;
  AA_FILTERS.urlIncludes = filters.urlIncludes || [];
  AA_FILTERS.methods = filters.methods || [];
  AA_FILTERS.resourceTypes = filters.resourceTypes || [];
  AA_FILTERS.captureBodies = filters.captureBodies || false;

  AA_FILTERS.urlRegex = filters.urlRegex
    ? new RegExp(filters.urlRegex)
    : null;
}

async function attachNetwork(tabId) {
  if (AA_DEBUG_SESSIONS.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000
    });

    AA_DEBUG_SESSIONS.set(tabId, {
      requestMap: new Map()
    });

    chrome.debugger.onEvent.addListener(handleNetworkEvent);

  } catch (err) {
    console.error("AA attach failed:", err);
  }
}

async function detachNetwork(tabId) {
  if (!AA_DEBUG_SESSIONS.has(tabId)) return;

  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}

  AA_DEBUG_SESSIONS.delete(tabId);
}

function handleNetworkEvent(source, method, params) {
  const tabId = source.tabId;
  if (!AA_DEBUG_SESSIONS.has(tabId)) return;
  if (!AA_FILTERS.enabled) return;

  const session = AA_DEBUG_SESSIONS.get(tabId);

  if (method === "Network.requestWillBeSent") {
    if (!passesFilter(params)) return;

    session.requestMap.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      type: params.type
    });

    forwardToTab(tabId, {
      type: "AA_NETWORK_REQUEST",
      data: {
        method: params.request.method,
        url: params.request.url,
        timestamp: Date.now()
      }
    });
  }

  if (method === "Network.loadingFinished") {
    if (!session.requestMap.has(params.requestId)) return;

    if (AA_FILTERS.captureBodies) {
      captureResponseBody(tabId, params.requestId);
    }

    session.requestMap.delete(params.requestId);
  }
}

function passesFilter(params) {
  const { url, method } = params.request;
  const type = params.type;

  if (AA_FILTERS.urlIncludes.length > 0) {
    const match = AA_FILTERS.urlIncludes.some(str => url.includes(str));
    if (!match) return false;
  }

  if (AA_FILTERS.urlRegex && !AA_FILTERS.urlRegex.test(url)) {
    return false;
  }

  if (AA_FILTERS.methods.length > 0 &&
      !AA_FILTERS.methods.includes(method)) {
    return false;
  }

  if (AA_FILTERS.resourceTypes.length > 0 &&
      !AA_FILTERS.resourceTypes.includes(type)) {
    return false;
  }

  return true;
}

async function captureResponseBody(tabId, requestId) {
  try {
    const response = await chrome.debugger.sendCommand(
      { tabId },
      "Network.getResponseBody",
      { requestId }
    );

    forwardToTab(tabId, {
      type: "AA_NETWORK_BODY",
      data: {
        requestId,
        body: response.body.slice(0, 10000),
        base64Encoded: response.base64Encoded
      }
    });

  } catch (err) {
    console.warn("AA body capture failed:", err.message);
  }
}

function forwardToTab(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}
