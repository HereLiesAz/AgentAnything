(function() {
// Agent Bridge - Specialized Input Injection Module (V2.0)
console.log("[AgentAnything] Agent Bridge V2 Loaded");

// --- 1. Selector Config (Phase 1) ---
const SELECTORS = {
    chatgpt: {
        input: '#prompt-textarea',
        submit: 'button[data-testid="send-button"]',
        stop: 'button[aria-label="Stop generating"]',
        lastMessage: 'div[data-message-author-role="assistant"]:last-of-type'
    },
    claude: {
        input: '.ProseMirror[contenteditable="true"]',
        submit: 'button[aria-label="Send Message"]',
        stop: '.result-streaming',
        lastMessage: '.font-claude-message:last-of-type'
    },
    gemini: {
        input: '.ql-editor, div[contenteditable="true"]',
        submit: '.send-button, button[aria-label="Send message"]',
        stop: '.run-spinner',
        lastMessage: 'message-content:last-of-type'
    }
};

// --- 2. Detection ---
function getProvider() {
    const host = window.location.hostname;
    if (host.includes('chatgpt')) return 'chatgpt';
    if (host.includes('claude')) return 'claude';
    if (host.includes('gemini') || host.includes('aistudio')) return 'gemini';
    return null;
}

const PROVIDER = getProvider();
console.log(`[AgentAnything] Bridge Active for: ${PROVIDER}`);

// --- 3. React Injection Logic (Phase 1) ---
function setReactValue(element, value) {
    element.focus();
    const lastValue = element.value;
    element.value = value;
    const event = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    // Hack to trigger React's internal state tracker
    const tracker = element._valueTracker;
    if (tracker) { tracker.setValue(lastValue); }
    element.dispatchEvent(event);
    element.dispatchEvent(changeEvent);
}

// --- 3.2 ContentEditable Injection Logic ---
function setContentEditableValue(element, value) {
    element.focus();
    element.innerHTML = '<p><br></p>'; // Reset
    const success = document.execCommand('insertText', false, value);

    if (!success) {
        console.warn("execCommand failed, using fallback");
        element.innerHTML = `<p>${value}</p>`;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
}


// --- 3.4 Determining "Busy" State ---
function isBusy() {
    const config = SELECTORS[PROVIDER];
    if (!config) return false;
    if (document.querySelector(config.stop)) return true;
    if (document.querySelector('.result-streaming')) return true;
    return false;
}


// --- 4. Message Listener (Phase 1) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Direct Execution
    if (request.action === "EXECUTE_PROMPT") {
        executePrompt(request.text);
        sendResponse({status: "success"});
        return true;
    }

    // Buffered Update
    if (request.action === "BUFFER_UPDATE") {
        bufferUpdate(request.text);
        sendResponse({status: "buffered"});
        return true;
    }
});

async function executePrompt(text) {
    const config = SELECTORS[PROVIDER];
    if (!config) return;

    let inputEl = document.querySelector(config.input);
    if (!inputEl) {
        console.error("Input not found");
        return;
    }

    if (PROVIDER === 'chatgpt') {
        setReactValue(inputEl, text);
    } else {
        setContentEditableValue(inputEl, text);
    }

    // Polling for submission (Robust Strategy)
    const startTime = Date.now();
    const interval = setInterval(() => {
        const btn = document.querySelector(config.submit) ||
                    document.querySelector('button[aria-label="Send message"]') ||
                    document.querySelector('button[data-testid="send-button"]');

        if (btn && !btn.disabled) {
            clearInterval(interval);
            btn.click();
            console.log("[AgentAnything] Prompt submitted via button click");
        } else if (Date.now() - startTime > 5000) {
            clearInterval(interval);
            // Fallback Enter
            console.warn("[AgentAnything] Button not ready, forcing Enter key");
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
    }, 100);
}


// --- 3.3 The Input Queue & Debouncer ---

let updateBuffer = [];
let agentDebounceTimer = null;

function bufferUpdate(text) {
    updateBuffer.push(text);
    scheduleInjection();
}

function scheduleInjection() {
    if (agentDebounceTimer) clearTimeout(agentDebounceTimer);

    if (isBusy()) {
        agentDebounceTimer = setTimeout(scheduleInjection, 1000);
        return;
    }

    agentDebounceTimer = setTimeout(() => {
        if (updateBuffer.length === 0) return;

        const combinedText = updateBuffer.join("\n\n");
        updateBuffer = []; // Clear buffer

        executePrompt(combinedText);
    }, 500); // 500ms stability window
}


// --- 5. Output Monitoring (Restore Parser) ---
// Monitors Agent Output to feed back to Service Worker

const sentCommands = new Set();
let lastMessageText = "";

function startMonitoring() {
    let lastState = false; // false = idle, true = busy

    const observer = new MutationObserver(() => {
        // 1. Check Busy State
        const busy = isBusy();
        if (busy !== lastState) {
            lastState = busy;
            if (!busy) {
                console.log("Agent became idle.");
            }
        }

        // 2. Parse Commands from LAST message only
        const config = SELECTORS[PROVIDER];
        if (!config || !config.lastMessage) return;

        const lastMsgEl = document.querySelector(config.lastMessage);

        if (lastMsgEl) {
            const text = lastMsgEl.innerText;
            if (text !== lastMessageText) {
                lastMessageText = text;
                parseCommands(text);
            }
        }
    });

    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-label'] });
}

function parseCommands(text) {
    // XML: <tool_code>...</tool_code>
    const xmlRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                console.log("Found command:", json);
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json }).catch(() => {});
                }
                sentCommands.add(raw);
            } catch (e) {
                console.error("Failed to parse command:", e);
            }
        }
    }

    // JSON Code Blocks
    const jsonRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
    while ((match = jsonRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                if (json.tool) {
                    console.log("Found legacy command:", json);
                    if (chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json }).catch(() => {});
                    }
                    sentCommands.add(raw);
                }
            } catch (e) {
                console.error("Failed to parse JSON command:", e, raw);
            }
        }
    }
}

// Start monitoring immediately
startMonitoring();
})();
