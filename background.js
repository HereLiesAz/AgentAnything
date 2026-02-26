// background.js

const attachedTabs = new Map(); 
// tabId -> { requests: Map<requestId, metadata> }

const FILTERS = {
  urlIncludes: [],       // ["api", "graphql"]
  urlRegex: null,        // /api\/v1\//
  methods: [],           // ["POST"]
  resourceTypes: []      // ["XHR", "Fetch"]
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (!tabId) return;

  if (message.type === "ATTACH_DEBUGGER") {
    attachDebugger(tabId);
    sendResponse({ success: true });
  }

  if (message.type === "DETACH_DEBUGGER") {
    detachDebugger(tabId);
    sendResponse({ success: true });
  }

  if (message.type === "SET_FILTERS") {
    updateFilters(message.filters);
    sendResponse({ success: true });
  }
});

function updateFilters(newFilters) {
  FILTERS.urlIncludes = newFilters.urlIncludes || [];
  FILTERS.methods = newFilters.methods || [];
  FILTERS.resourceTypes = newFilters.resourceTypes || [];
  FILTERS.urlRegex = newFilters.urlRegex
    ? new RegExp(newFilters.urlRegex)
    : null;
}

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000
    });

    attachedTabs.set(tabId, {
      requests: new Map()
    });

    chrome.debugger.onEvent.addListener(handleDebuggerEvent);

    console.log("CDP attached:", tabId);
  } catch (err) {
    console.error("Attach failed:", err);
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    console.log("CDP detached:", tabId);
  } catch (err) {
    console.error("Detach failed:", err);
  }
}

function handleDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (!attachedTabs.has(tabId)) return;

  const tabData = attachedTabs.get(tabId);

  if (method === "Network.requestWillBeSent") {
    if (!passesFilter(params)) return;

    tabData.requests.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      type: params.type
    });

    forward(tabId, {
      type: "NETWORK_REQUEST",
      data: params
    });
  }

  if (method === "Network.responseReceived") {
    if (!tabData.requests.has(params.requestId)) return;

    forward(tabId, {
      type: "NETWORK_RESPONSE",
      data: params
    });
  }

  if (method === "Network.loadingFinished") {
    if (!tabData.requests.has(params.requestId)) return;

    captureResponseBody(tabId, params.requestId);
  }
}

function passesFilter(params) {
  const { url, method } = params.request;
  const type = params.type;

  if (FILTERS.urlIncludes.length > 0) {
    const match = FILTERS.urlIncludes.some(str =>
      url.includes(str)
    );
    if (!match) return false;
  }

  if (FILTERS.urlRegex && !FILTERS.urlRegex.test(url)) {
    return false;
  }

  if (FILTERS.methods.length > 0 &&
      !FILTERS.methods.includes(method)) {
    return false;
  }

  if (FILTERS.resourceTypes.length > 0 &&
      !FILTERS.resourceTypes.includes(type)) {
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

    forward(tabId, {
      type: "NETWORK_BODY",
      data: {
        requestId,
        body: response.body,
        base64Encoded: response.base64Encoded
      }
    });

  } catch (err) {
    console.warn("Body capture failed:", err.message);
  }
}

function forward(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}
