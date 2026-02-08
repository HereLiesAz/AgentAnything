
const assert = require('assert');

// Mock Chrome Storage Local
const storage = {
    local: {
        _data: {},
        get: async (keys) => {
            if (typeof keys === 'string') return { [keys]: storage.local._data[keys] };
            if (Array.isArray(keys)) {
                let res = {};
                keys.forEach(k => res[k] = storage.local._data[k]);
                return res;
            }
            if (typeof keys === 'object') {
                 let res = {};
                 for (let k in keys) {
                     res[k] = storage.local._data[k] !== undefined ? storage.local._data[k] : keys[k];
                 }
                 return res;
            }
            return storage.local._data;
        },
        set: async (items) => {
            Object.assign(storage.local._data, items);
            // Trigger onChanged
            if (storage.onChanged.listeners.length > 0) {
                 storage.onChanged.listeners.forEach(fn => fn({
                     commandQueue: { newValue: items.commandQueue }
                 }, 'local'));
            }
        },
    },
    onChanged: {
        listeners: [],
        addListener: (fn) => storage.onChanged.listeners.push(fn)
    }
};

global.chrome = { storage };

// --- Copy Background Logic (Simplified) ---
const DEFAULT_STATE = {
    agentTabId: null,
    targetTabs: [],
    commandQueue: [],
    isAgentBusy: false
};

async function getState() {
    const data = await chrome.storage.local.get(DEFAULT_STATE);
    if (!Array.isArray(data.targetTabs)) data.targetTabs = [];
    if (!Array.isArray(data.commandQueue)) data.commandQueue = [];
    return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
    await chrome.storage.local.set(updates);
}

// Minimal Queue Processor for Test (Simulating processQueue in background.js)
async function processQueue(queue) {
    if (!queue || queue.length === 0) return;
    const item = queue[0];

    // Simulate processing
    if (item.type === 'TEST_CMD') {
        if (!global.processed) global.processed = 0;
        global.processed++;
    }

    // Dequeue - this triggers onChanged again in real logic
    const remaining = queue.slice(1);
    await updateState({ commandQueue: remaining });
}

// Mock Listener Registration
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.commandQueue) {
        processQueue(changes.commandQueue.newValue);
    }
});


// --- TESTS ---

async function runTests() {
    console.log("Running Background V2 Tests...");

    // Test 1: Storage Persistence
    await updateState({ agentTabId: 999 });
    let state = await getState();
    assert.strictEqual(state.agentTabId, 999, "Agent ID persists in local storage");

    // Test 2: Event Driven Queue
    global.processed = 0;
    // We need to break infinite recursion in mock because mock is synchronous mostly?
    // Actually, async recursion is fine.

    await updateState({ commandQueue: [{ type: 'TEST_CMD' }] });

    // Wait for async processing chain
    await new Promise(r => setTimeout(r, 100));

    state = await getState();
    assert.strictEqual(global.processed, 1, "Queue should process 1 item");
    assert.strictEqual(state.commandQueue.length, 0, "Queue should be empty after processing");

    // Test 3: Multiple Items
    global.processed = 0;
    await updateState({ commandQueue: [{ type: 'TEST_CMD' }, { type: 'TEST_CMD' }] });

    await new Promise(r => setTimeout(r, 200));

    state = await getState();
    assert.strictEqual(global.processed, 2, "Queue should process 2 items recursively");
    assert.strictEqual(state.commandQueue.length, 0, "Queue empty");

    console.log("All Background V2 Tests Passed!");
}

runTests().catch(e => {
    console.error("Test Failed:", e);
    process.exit(1);
});
