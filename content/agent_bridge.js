(function() {
// Agent Bridge - Specialized Input Injection Module (V2.1)
// FIXES: XSS in setContentEditableValue, sentCommands memory leak, isBusy() provider specificity
console.log("[AgentAnything] Agent Bridge V2.1 Loaded");

// --- 1. Selector Config ---
// IMPORTANT — stop selectors must ONLY match elements that are present while the AI is
// actively generating. Do NOT use broad selectors that also match static UI chrome
// (copy buttons, thumbs-up icons, etc.) — those will cause isBusy() to always return true,
// which permanently blocks the injection debounce loop.
const SELECTORS = {
    chatgpt: {
        input: '#prompt-textarea',
        submit: 'button[data-testid="send-button"]',
        // The stop button only appears while generating
        stop: 'button[data-testid="stop-button"]',
        lastMessage: 'div[data-message-author-role="assistant"]:last-of-type'
    },
    claude: {
        input: '.ProseMirror[contenteditable="true"], div[contenteditable="true"][data-placeholder]',
        submit: 'button[aria-label="Send Message"], button[data-testid="send-button"]',
        // [data-is-streaming] is the attribute Claude sets on the response container while generating.
        // This is much more specific than any button selector.
        stop: '[data-is-streaming="true"]',
        lastMessage: '.font-claude-message:last-of-type'
    },
    gemini: {
        input: '.ql-editor, div[contenteditable="true"]',
        submit: '.send-button, button[aria-label="Send message"]',
        // .run-spinner only appears while Gemini is generating
        stop: '.run-spinner',
        lastMessage: 'message-content:last-of-type, .response-container:last-of-type'
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

// --- 2.1 Observation Mode State ---
let observationMode = false;
let sessionKeyword = null;
let learnedSelectors = { input: null, submit: null };
let potentialSelectors = { input: null, submit: null };

window.addEventListener('click', (e) => {
    if (observationMode) potentialSelectors.submit = e.target;
}, true);

window.addEventListener('focus', (e) => {
    if (observationMode) {
        const t = e.target;
        if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
            potentialSelectors.input = t;
        }
    }
}, true);
window.addEventListener('input', (e) => {
    if (observationMode) potentialSelectors.input = e.target;
}, true);


// --- 3. React Injection Logic ---
function setReactValue(element, value) {
    element.focus();
    const lastValue = element.value;
    element.value = value;
    const event = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    const tracker = element._valueTracker;
    if (tracker) { tracker.setValue(lastValue); }
    element.dispatchEvent(event);
    element.dispatchEvent(changeEvent);
}

// --- 3.2 ContentEditable / ProseMirror Injection ---
// FIX: Previous version used innerHTML fallback which allowed XSS from page content.
// Now uses DataTransfer paste (best ProseMirror support) with a safe execCommand fallback.
function setContentEditableValue(element, value) {
    element.focus();

    // Select all existing content first
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    // Strategy 1: DataTransfer paste event — works best with ProseMirror (Claude, Gemini)
    try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', value);
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        });
        const handled = element.dispatchEvent(pasteEvent);
        if (!pasteEvent.defaultPrevented) {
            // ProseMirror handled it (it calls preventDefault on paste)
            // If not prevented, the paste didn't register — fall through
            throw new Error("Paste not intercepted by framework");
        }
        return;
    } catch(e) {
        console.warn("[AgentAnything] DataTransfer paste failed, trying execCommand:", e.message);
    }

    // Strategy 2: execCommand insertText (works for most contenteditable, deprecated but still functional in Chrome)
    const success = document.execCommand('insertText', false, value);
    if (success) return;

    // Strategy 3: Last resort — direct textContent (no XSS risk since we use textContent not innerHTML)
    console.warn("[AgentAnything] execCommand failed, using textContent fallback");
    element.textContent = '';
    const p = document.createElement('p');
    p.textContent = value; // FIX: textContent is safe; old code used innerHTML = `<p>${value}</p>` which was XSS
    element.appendChild(p);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- 3.3 Click Simulation ---
function simulateClick(element) {
    const options = { bubbles: true, cancelable: true, view: window };
    const hasPointer = typeof PointerEvent !== 'undefined';
    const events = hasPointer ?
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] :
        ['mousedown', 'mouseup', 'click'];

    events.forEach(type => {
        const Ctor = hasPointer && type.startsWith('pointer') ? PointerEvent : MouseEvent;
        element.dispatchEvent(new Ctor(type, options));
    });
}


// --- 3.4 Determining "Busy" State ---
// Returns true only while the AI is actively generating a response.
// MUST be conservative — a false positive here will permanently stall the injection loop.
function isBusy() {
    const config = SELECTORS[PROVIDER];
    if (!config || !config.stop) return false;
    const stopEl = document.querySelector(config.stop);
    if (!stopEl) return false;
    // Ensure the element is actually visible, not just present in the DOM
    return stopEl.offsetParent !== null || stopEl.offsetWidth > 0 || stopEl.offsetHeight > 0;
}


// --- 4. Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "INIT_AGENT") {
        if (request.keyword) {
            sessionKeyword = request.keyword;
            observationMode = true;
            learnedSelectors = { input: null, submit: null };
            potentialSelectors = { input: null, submit: null };
            // FIX: Clear sentCommands on new session to prevent memory leak
            sentCommands.clear();
            console.log(`[AgentAnything] Observation Mode Active. Keyword: ${sessionKeyword}`);
        }
    }

    if (request.action === "EXECUTE_PROMPT") {
        executePrompt(request.text);
        sendResponse({status: "success"});
        return true;
    }

    if (request.action === "BUFFER_UPDATE") {
        bufferUpdate(request.text);
        sendResponse({status: "buffered"});
        return true;
    }
});

async function executePrompt(text) {
    const config = SELECTORS[PROVIDER];
    if (!config) return;

    if (observationMode) {
        navigator.clipboard.writeText(text).catch(e => console.warn("Clipboard write failed", e));
    }

    let inputEl = learnedSelectors.input || document.querySelector(config.input);
    if (!inputEl) {
        console.error("[AgentAnything] Input not found");
        return;
    }

    if (PROVIDER === 'chatgpt') {
        setReactValue(inputEl, text);
    } else {
        setContentEditableValue(inputEl, text);
    }

    // Polling for submit button
    const startTime = Date.now();
    let lastRetryTimestamp = 0;

    const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - startTime;

        let btn = learnedSelectors.submit;
        if (!btn) {
            btn = document.querySelector(config.submit) ||
                  document.querySelector('button[aria-label="Send message"]') ||
                  document.querySelector('button[data-testid="send-button"]');
        }

        if (btn && !btn.disabled) {
            clearInterval(interval);
            simulateClick(btn);
            console.log("[AgentAnything] Prompt submitted via button click");
            // Safety net: poll for commands after submission in case the streaming
            // indicator is too brief for the MutationObserver to catch the idle edge.
            schedulePostSubmitScan();
        } else {
            if (elapsed > 5000) {
                clearInterval(interval);
                console.warn("[AgentAnything] Button not ready after 5s, forcing Enter key");
                const eventOpts = { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, view: window, composed: true };
                inputEl.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
                schedulePostSubmitScan();
            } else if (btn && btn.disabled && (elapsed > 2000)) {
                 if (now - lastRetryTimestamp > 1000) {
                     lastRetryTimestamp = now;
                     console.log("[AgentAnything] Button disabled, re-dispatching input");
                     inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                 }
            }
        }
    }, 100);
}

// Poll for a completed response after prompt submission.
// Checks every second for up to 90 seconds, stopping as soon as the AI becomes idle
// and new text appears. This is a fallback for when the streaming indicator is
// too brief or absent, so the MutationObserver's idle-edge detection misses it.
function schedulePostSubmitScan() {
    const maxAttempts = 90;
    let attempts = 0;
    let lastSeen = lastMessageText;

    const poll = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(poll);
            return;
        }

        // Stop polling once the observer has already caught a change
        if (lastMessageText !== lastSeen) {
            clearInterval(poll);
            return;
        }

        // If idle, scan now
        if (!isBusy()) {
            const config = SELECTORS[PROVIDER];
            if (!config) { clearInterval(poll); return; }
            const lastMsgEl = document.querySelector(config.lastMessage);
            if (lastMsgEl) {
                const text = lastMsgEl.innerText;
                if (text && text !== lastSeen) {
                    clearInterval(poll);
                    lastMessageText = text;
                    lastSeen = text;
                    console.log("[AgentAnything] Post-submit scan found new response.");

                    if (observationMode && sessionKeyword && text.includes(sessionKeyword)) {
                        console.log("[AgentAnything] Session Keyword Detected (post-submit scan)!");
                        observationMode = false;
                        if (potentialSelectors.submit) learnedSelectors.submit = potentialSelectors.submit;
                        if (potentialSelectors.input) learnedSelectors.input = potentialSelectors.input;
                        if (chrome.runtime?.id) {
                            chrome.runtime.sendMessage({ action: "INTRO_COMPLETE" }).catch(() => {});
                        }
                    }

                    parseCommands(text);
                }
            }
        }
    }, 1000);
}


// --- 3.5 Input Queue & Debouncer ---

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
        updateBuffer = [];

        executePrompt(combinedText);
    }, 500);
}


// --- 5. Output Monitoring ---

// FIX: Declared here so INIT_AGENT handler can call sentCommands.clear()
const sentCommands = new Set();
let lastMessageText = "";

function startMonitoring() {
    // Track whether the AI was busy on the previous mutation tick.
    // We only parse commands on the falling edge: busy → idle.
    // Parsing mid-stream risks catching truncated command JSON.
    let wasBusy = false;

    const observer = new MutationObserver(() => {
        const busy = isBusy();

        // Falling edge: AI just finished generating
        if (wasBusy && !busy) {
            console.log("[AgentAnything] Agent became idle — scanning for commands.");
            checkForKeywordAndCommands();
        }
        // Also check on rising edge in case a response arrives without a busy state
        // (e.g. very fast completions that never trigger the stop indicator)
        else if (!wasBusy && !busy) {
            checkForKeywordAndCommands();
        }

        wasBusy = busy;
    });

    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'disabled', 'aria-label', 'data-is-streaming']
    });
}

function checkForKeywordAndCommands() {
    const config = SELECTORS[PROVIDER];
    if (!config || !config.lastMessage) return;

    const lastMsgEl = document.querySelector(config.lastMessage);
    if (!lastMsgEl) return;

    const text = lastMsgEl.innerText;

    // Only process if the text has actually changed since last check
    if (text === lastMessageText) return;
    lastMessageText = text;

    // Check for session keyword (end of Observation Mode)
    if (observationMode && sessionKeyword && text.includes(sessionKeyword)) {
        console.log("[AgentAnything] Session Keyword Detected!");
        observationMode = false;

        if (potentialSelectors.submit) learnedSelectors.submit = potentialSelectors.submit;
        if (potentialSelectors.input) learnedSelectors.input = potentialSelectors.input;

        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ action: "INTRO_COMPLETE" }).catch(() => {});
        }
    }

    parseCommands(text);
}

function parseCommands(text) {
    const xmlRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                console.log("[AgentAnything] Found command:", json);
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json }).catch(() => {});
                }
                sentCommands.add(raw);
            } catch (e) {
                console.error("[AgentAnything] Failed to parse command:", e);
            }
        }
    }

    const jsonRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
    while ((match = jsonRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                if (json.tool) {
                    console.log("[AgentAnything] Found legacy command:", json);
                    if (chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json }).catch(() => {});
                    }
                    sentCommands.add(raw);
                }
            } catch (e) {
                console.error("[AgentAnything] Failed to parse JSON command:", e, raw);
            }
        }
    }
}

startMonitoring();
})();
