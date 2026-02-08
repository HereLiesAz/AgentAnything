
const assert = require('assert');

// Mock Chrome Storage
const storage = {
    session: {
        _data: {},
        get: async (keys) => {
            if (typeof keys === 'string') return { [keys]: storage.session._data[keys] };
            if (Array.isArray(keys)) {
                let res = {};
                keys.forEach(k => res[k] = storage.session._data[k]);
                return res;
            }
            if (typeof keys === 'object') {
                 let res = {};
                 for (let k in keys) {
                     res[k] = storage.session._data[k] !== undefined ? storage.session._data[k] : keys[k];
                 }
                 return res;
            }
            return storage.session._data;
        },
        set: async (items) => {
            Object.assign(storage.session._data, items);
        },
        remove: async (keys) => {
             if (Array.isArray(keys)) keys.forEach(k => delete storage.session._data[k]);
        },
        clear: async () => { storage.session._data = {}; }
    }
};

global.chrome = { storage };

// --- Copy Background Logic (Simplified for testing) ---
// In a real setup, we would export/import, but for this constraint environment, we'll inline the core logic to test.

const DEFAULT_STATE = {
    agentTabId: null,
    targetTabIds: [],
    messageQueue: [],
    isAgentBusy: false,
    busySince: 0
};

async function getState() {
    const data = await chrome.storage.session.get(DEFAULT_STATE);
    if (!Array.isArray(data.targetTabIds)) data.targetTabIds = [];
    return { ...DEFAULT_STATE, ...data };
}

async function updateState(updates) {
    await chrome.storage.session.set(updates);
}

// Mutex
let stateMutex = Promise.resolve();
async function withLock(fn) {
    const next = stateMutex.then(async () => {
        try { await fn(); } catch (e) { console.error(e); }
    });
    stateMutex = next;
    return next;
}

// Deadlock Logic from processQueue
async function checkDeadlock() {
    const state = await getState();
    if (state.isAgentBusy) {
        if (Date.now() - (state.busySince || 0) > 180000) {
            await updateState({ isAgentBusy: false, busySince: 0 });
            return true; // Unlocked
        }
    }
    return false;
}

// --- TESTS ---

async function runTests() {
    console.log("Running Background Logic Tests...");

    // Test 1: State Persistence
    await updateState({ agentTabId: 123 });
    let state = await getState();
    assert.strictEqual(state.agentTabId, 123, "Agent Tab ID should persist");

    // Test 2: Deadlock Recovery
    const now = Date.now();
    await updateState({ isAgentBusy: true, busySince: now - 200000 }); // 3m 20s ago
    const unlocked = await checkDeadlock();
    state = await getState();
    assert.strictEqual(unlocked, true, "Should detect deadlock");
    assert.strictEqual(state.isAgentBusy, false, "Should auto-unlock");

    // Test 3: No False Positive Deadlock
    await updateState({ isAgentBusy: true, busySince: now - 10000 }); // 10s ago
    const unlockedFalse = await checkDeadlock();
    state = await getState();
    assert.strictEqual(unlockedFalse, false, "Should NOT detect deadlock yet");
    assert.strictEqual(state.isAgentBusy, true, "Should remain locked");

    // Test 4: Mutex Sequencing
    let log = [];
    const p1 = withLock(async () => {
        await new Promise(r => setTimeout(r, 50));
        log.push(1);
    });
    const p2 = withLock(async () => {
        log.push(2);
    });
    await Promise.all([p1, p2]);
    assert.deepStrictEqual(log, [1, 2], "Mutex should serialize execution order");

    console.log("All Background Tests Passed!");
}

runTests().catch(e => {
    console.error("Test Failed:", e);
    process.exit(1);
});
