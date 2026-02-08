
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
    lastActionTimestamp: 0
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

// Timeout Logic
async function checkTimeout() {
    const state = await getState();
    if (state.lastActionTimestamp > 0 && (Date.now() - state.lastActionTimestamp > 15000)) {
        await updateState({ lastActionTimestamp: 0 });
        // Simulating enqueuing error
        global.timeoutFired = true;
    }
}

// Interrupt Logic
async function handleInterrupt() {
    await updateState({ commandQueue: [], lastActionTimestamp: 0 });
}


// --- TESTS ---

async function runTests() {
    console.log("Running Background Robustness Tests...");

    // Test 1: Timeout Logic
    await updateState({ lastActionTimestamp: Date.now() - 20000 }); // 20s ago
    global.timeoutFired = false;
    await checkTimeout();
    assert.strictEqual(global.timeoutFired, true, "Timeout should fire after 15s");
    let state = await getState();
    assert.strictEqual(state.lastActionTimestamp, 0, "Timeout should reset timestamp");

    // Test 2: Interrupt Logic
    await updateState({ commandQueue: [{type: 'CMD1'}, {type: 'CMD2'}] });
    await handleInterrupt();
    state = await getState();
    assert.strictEqual(state.commandQueue.length, 0, "Interrupt should clear queue");

    console.log("All Robustness Tests Passed!");
}

runTests().catch(e => {
    console.error("Test Failed:", e);
    process.exit(1);
});
