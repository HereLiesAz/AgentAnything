// background.js
// =============================
// AgentAnything – Full Service Worker
// =============================

// -------------------- Imports / Setup --------------------
const CONFIG = { debug: false }; // overridden from sync
const log = (...args) => CONFIG.debug && console.log('[BG]', ...args);

// Ensure session storage can be accessed from content scripts (required for some APIs)
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// In-memory mutex lock for storage writes
let lock = Promise.resolve();
function withLock(fn) {
  lock = lock.then(fn, fn);
  return lock;
}

// Keep-alive using offscreen document
let keepAliveInterval;
function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' }).catch(() => {});
    checkTimeout(); // also check for stalled actions
  }, 20000);
}
startKeepAlive();

// -------------------- State Helpers --------------------
const DEFAULT_STATE = {
  agentTabId: null,
  agentUrl: null,
  targetTabs: [],          // { tabId, url }
  commandQueue: [],
  elementMap: {},          // elementId -> tabId (not heavily used)
  lastActionTimestamp: 0,
  observationMode: false,
  sessionKeyword: null,
  isAgentBusy: false,
  busySince: 0
};

async function getState() {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  // Ensure arrays exist
  if (!Array.isArray(data.targetTabs)) data.targetTabs = [];
  if (!Array.isArray(data.commandQueue)) data.commandQueue = [];
  return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
  await chrome.storage.local.set(updates);
  await broadcastStatus(); // update dashboards
}

// -------------------- Broadcast Status to All Tabs --------------------
async function broadcastStatus() {
  const state = await getState();
  const payload = {
    status: state.observationMode ? 'Observing' : (state.commandQueue.length ? 'Working' : 'Idle'),
    color: state.observationMode ? '#ffaa00' : (state.commandQueue.length ? '#00cc00' : '#888'),
    queueLength: state.commandQueue.length,
    lastAction: state.lastActionTimestamp,
    isAgentTab: false, // will be overridden per tab
    allowInput: true
  };

  // Send to all tabs that might have dashboard
  const allTabIds = [state.agentTabId, ...state.targetTabs.map(t => t.tabId)].filter(Boolean);
  for (const tabId of allTabIds) {
    try {
      const tabPayload = { ...payload, isAgentTab: (tabId === state.agentTabId) };
      await chrome.tabs.sendMessage(tabId, { action: 'DASHBOARD_UPDATE', ...tabPayload }).catch(() => {});
    } catch (_) {}
  }
}

// -------------------- Message Handlers --------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    log('Message received', message, 'from', sender);

    // ===== Popup Actions =====
    if (message.action === 'ASSIGN_ROLE') {
      const { role, tabId, task } = message;
      if (role === 'AGENT') {
        await assignAgent(tabId, task);
      } else if (role === 'TARGET') {
        await assignTarget(tabId);
      }
      sendResponse({ success: true });
    }

    if (message.action === 'REMOTE_INJECT') {
      const state = await getState();
      if (state.agentTabId) {
        await sendMessageToTab(state.agentTabId, { action: 'EXECUTE_PROMPT', text: message.payload });
      }
      sendResponse({ success: true });
    }

    if (message.action === 'DISENGAGE_ALL') {
      await disengageAll();
      sendResponse({ success: true });
    }

    if (message.action === 'SAVE_TOOL') {
      await saveTool(message.name, message.url);
      sendResponse({ success: true });
    }

    if (message.action === 'DELETE_TOOL') {
      await deleteTool(message.id);
      sendResponse({ success: true });
    }

    // ===== Content Script Actions =====
    if (message.action === 'TARGET_UPDATE') {
      // Forward update to agent (via queue)
      const state = await getState();
      if (state.agentTabId && !state.observationMode) {
        // Build context string
        let context = `[Target Update]\nURL: ${sender.url}\nInteractive Elements:\n${message.payload}`;
        await enqueueUpdate(context);
      }
    }

    if (message.action === 'AGENT_COMMAND') {
      await handleAgentCommand(message);
    }

    if (message.action === 'INTRO_COMPLETE') {
      await updateState({ observationMode: false });
    }

    if (message.action === 'USER_INTERRUPT') {
      // Clear queue if user interacts with target tab
      await updateState({ commandQueue: [] });
    }

    // ===== Internal =====
    if (message.action === 'GET_COORDINATES_RESPONSE') {
      // Used by CDP execution – handled in processQueue
    }

    // Must return true for async response
  })().catch(err => log('Error in message handler', err));
  return true; // keep channel open for async sendResponse
});

// -------------------- Assignment Functions --------------------
async function assignAgent(tabId, task) {
  // Clear any previous assignments
  await disengageAll();

  const tab = await chrome.tabs.get(tabId);
  const sessionKeyword = `[END:${tab.url}-${Date.now()}]`;

  await updateState({
    agentTabId: tabId,
    agentUrl: tab.url,
    observationMode: true,
    sessionKeyword,
    commandQueue: []
  });

  // Send init message to agent tab
  await sendMessageToTab(tabId, { action: 'INIT_AGENT', keyword: sessionKeyword });

  // After a short delay, inject the initial system prompt
  setTimeout(async () => {
    const state = await getState();
    if (state.agentTabId !== tabId) return; // changed
    const prompt = await buildInitialPrompt(task);
    await sendMessageToTab(tabId, { action: 'EXECUTE_PROMPT', text: prompt });
  }, 500);
}

async function assignTarget(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const state = await getState();
  const targetTabs = state.targetTabs || [];
  // Avoid duplicates
  if (targetTabs.some(t => t.tabId === tabId)) return;

  targetTabs.push({ tabId, url: tab.url });
  await updateState({ targetTabs });

  // Initialize target adapter
  await sendMessageToTab(tabId, { action: 'INIT_TARGET', config: {} });
}

async function disengageAll() {
  const state = await getState();

  // Detach debugger from all target tabs
  for (const t of state.targetTabs) {
    try {
      await chrome.debugger.detach({ tabId: t.tabId });
    } catch (_) {}
  }

  // Clear state
  await updateState({
    agentTabId: null,
    agentUrl: null,
    targetTabs: [],
    commandQueue: [],
    observationMode: false,
    sessionKeyword: null
  });

  // Send "disengaged" status to all tabs (so dashboards reset)
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'DASHBOARD_UPDATE',
        status: 'Disengaged',
        color: '#888',
        queueLength: 0,
        lastAction: 0,
        isAgentTab: false,
        allowInput: true
      });
    } catch (_) {}
  }
}

// -------------------- Tool Management --------------------
async function saveTool(name, url) {
  const { savedTools = [] } = await chrome.storage.sync.get('savedTools');
  const newTool = { id: Date.now().toString(), name, url };
  savedTools.push(newTool);
  await chrome.storage.sync.set({ savedTools });
}

async function deleteTool(id) {
  const { savedTools = [] } = await chrome.storage.sync.get('savedTools');
  const filtered = savedTools.filter(t => t.id !== id);
  await chrome.storage.sync.set({ savedTools: filtered });
}

// -------------------- Command Queue --------------------
async function enqueueUpdate(text) {
  await withLock(async () => {
    const state = await getState();
    if (!state.agentTabId) return;
    // Queue an UPDATE_AGENT item
    const queue = state.commandQueue;
    queue.push({ type: 'UPDATE_AGENT', payload: { text } });
    await updateState({ commandQueue: queue });
  });
}

async function handleAgentCommand(cmd) {
  await withLock(async () => {
    const state = await getState();
    if (!state.agentTabId) return;

    let queueItem = null;
    if (cmd.action === 'click' || cmd.action === 'type') {
      queueItem = { type: 'CLICK_TARGET', payload: cmd };
    } else if (cmd.action === 'open_tab') {
      queueItem = { type: 'OPEN_TAB', payload: { url: cmd.url } };
    } else if (cmd.action === 'open_tool') {
      queueItem = { type: 'OPEN_TOOL', payload: { name: cmd.name } };
    } else {
      log('Unknown command', cmd);
      return;
    }

    const queue = state.commandQueue;
    queue.push(queueItem);
    await updateState({ commandQueue: queue });
  });
}

// Process queue (called on each storage change)
let isProcessing = false;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.commandQueue) {
    if (!isProcessing) processQueue();
  }
});

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (true) {
      const state = await getState();
      if (!state.commandQueue.length) break;

      const item = state.commandQueue[0];
      log('Processing queue item', item);

      let success = false;
      if (item.type === 'UPDATE_AGENT') {
        success = await processUpdateAgent(item.payload);
      } else if (item.type === 'CLICK_TARGET') {
        success = await processClickTarget(item.payload);
      } else if (item.type === 'OPEN_TAB') {
        success = await processOpenTab(item.payload);
      } else if (item.type === 'OPEN_TOOL') {
        success = await processOpenTool(item.payload);
      }

      if (success) {
        // Remove the processed item
        await withLock(async () => {
          const s = await getState();
          s.commandQueue.shift();
          await updateState({ commandQueue: s.commandQueue });
        });
      } else {
        // If failed, we might want to keep it? For now, remove to avoid infinite loop
        await withLock(async () => {
          const s = await getState();
          s.commandQueue.shift();
          await updateState({ commandQueue: s.commandQueue });
        });
        // Optionally send error to agent
        await enqueueUpdate('System: Action failed.');
      }

      // Wait a bit before next item to allow DOM updates
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    isProcessing = false;
  }
}

// -------------------- Queue Item Processors --------------------
async function processUpdateAgent(payload) {
  const state = await getState();
  if (!state.agentTabId) return false;
  await sendMessageToTab(state.agentTabId, { action: 'BUFFER_UPDATE', text: payload.text });
  return true;
}

async function processClickTarget(cmd) {
  const state = await getState();
  // Find which target tab contains this element (simplified: assume first target tab)
  // In a full implementation, you'd store element->tab mapping in elementMap.
  if (!state.targetTabs.length) return false;
  const tabId = state.targetTabs[0].tabId; // for now use first

  // Get element coordinates
  const coords = await getElementCoords(tabId, cmd.id);
  if (!coords) return false;

  // Execute click or type via CDP
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    if (cmd.action === 'click') {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1
      });
    } else if (cmd.action === 'type') {
      // Focus the element first (click)
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1
      });
      // Type each character
      for (const ch of cmd.value) {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: ch
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'char',
          key: ch,
          text: ch,
          unmodifiedText: ch
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: ch
        });
      }
    }
    await chrome.debugger.detach({ tabId });
    await updateState({ lastActionTimestamp: Date.now() });
    return true;
  } catch (err) {
    log('CDP error', err);
    return false;
  }
}

async function getElementCoords(tabId, elementId) {
  return new Promise(resolve => {
    const listener = (msg, sender, sendResponse) => {
      if (msg.action === 'GET_COORDINATES_RESPONSE' && msg.forId === elementId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg.coords);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.sendMessage(tabId, { action: 'GET_COORDINATES', id: elementId }).catch(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    });
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    }, 3000);
  });
}

async function processOpenTab(payload) {
  const { url } = payload;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    // Wait for tab to load, then assign as target
    await waitForTabLoad(tab.id);
    await assignTarget(tab.id);
    return true;
  } catch (err) {
    log('Open tab failed', err);
    return false;
  }
}

async function processOpenTool(payload) {
  const { name } = payload;
  const { savedTools = [] } = await chrome.storage.sync.get('savedTools');
  const tool = savedTools.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (!tool) {
    const names = savedTools.map(t => t.name).join(', ');
    await enqueueUpdate(`System: Tool "${name}" not found. Available tools: ${names || 'none'}`);
    return false;
  }
  return await processOpenTab({ url: tool.url });
}

// -------------------- Helpers --------------------
async function sendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {}
}

async function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Small delay for content scripts to initialize
        setTimeout(resolve, 600);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function buildInitialPrompt(task) {
  const { savedTools = [] } = await chrome.storage.sync.get('savedTools');
  const { maxTabs = 3 } = await chrome.storage.sync.get('maxTabs');

  let prompt = `You are an autonomous web agent. An extension feeds you live browser state and executes your commands.

═══ COMMAND REFERENCE ═══
Output ONE command at a time as JSON inside <tool_code> tags:

  Click an element:       <tool_code>{"action": "click", "id": <number>}</tool_code>
  Type into a field:      <tool_code>{"action": "type", "id": <number>, "value": "<text>"}</tool_code>
  Open a URL (new tab):   <tool_code>{"action": "open_tab", "url": "<full URL>"}</tool_code>
  Open a saved Tool:      <tool_code>{"action": "open_tool", "name": "<exact tool name>"}</tool_code>

`;

  if (savedTools.length) {
    prompt += `═══ AVAILABLE TOOLS ═══\n`;
    savedTools.forEach(t => prompt += `  • ${t.name} → ${t.url}\n`);
    prompt += '\n';
  }

  prompt += `═══ CONSTRAINTS ═══
• You may control up to ${maxTabs} tabs simultaneously.
• When you open a new tab at the limit, the oldest tab is automatically released.
• After every action you will receive updated DOM snapshots of all active target tabs.
• Interactive elements in each snapshot are numbered — use those numbers as "id" values.
• Wait for a DOM update before issuing the next command; do not chain multiple commands at once.

`;

  if (task) {
    prompt += `═══ YOUR GOAL ═══\n${task}\n\n`;
  }

  prompt += `IMPORTANT: End EVERY response with this exact keyword: `;
  const state = await getState();
  prompt += state.sessionKeyword || '[MISSING_KEYWORD]';
  return prompt;
}

// -------------------- Timeout Detection --------------------
async function checkTimeout() {
  const state = await getState();
  if (state.lastActionTimestamp > 0 && Date.now() - state.lastActionTimestamp > 15000) {
    await enqueueUpdate('System: Action executed but no DOM change detected within 15 seconds.');
    await updateState({ lastActionTimestamp: 0 });
  }
}

// -------------------- Configuration Load --------------------
async function loadConfig() {
  const sync = await chrome.storage.sync.get({ debugMode: false });
  CONFIG.debug = sync.debugMode;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.debugMode) {
    CONFIG.debug = changes.debugMode.newValue;
  }
});
loadConfig();
