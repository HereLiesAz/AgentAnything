// Agent Adapter - Controls the LLM Interface
console.log("[AgentAnything] Agent Adapter Loaded");

// Detect Provider
const PROVIDER = (() => {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com')) return 'CHATGPT';
    if (host.includes('claude.ai')) return 'CLAUDE';
    if (host.includes('gemini.google.com') || host.includes('aistudio.google.com')) return 'GEMINI';
    return 'UNKNOWN';
})();

console.log(`[AgentAnything] Detected Provider: ${PROVIDER}`);

// --- INPUT HELPERS ---

function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
    }

    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

// --- PROVIDER IMPLEMENTATIONS ---

const Strategies = {
    CHATGPT: {
        getInput: () => document.querySelector('#prompt-textarea') || document.querySelector('textarea[data-id="root"]'),
        getSendButton: () => document.querySelector('button[data-testid="send-button"]'),
        isGenerating: () => !!document.querySelector('button[aria-label="Stop generating"]') || !!document.querySelector('.result-streaming'),
        setValue: (el, val) => {
             el.focus();
             setNativeValue(el, val);
             el.style.height = 'auto';
             el.style.height = el.scrollHeight + 'px';
        },
        getLastMessage: () => {
            const msgs = document.querySelectorAll('div[data-message-author-role="assistant"]');
            return msgs[msgs.length - 1];
        }
    },
    CLAUDE: {
        getInput: () => document.querySelector('.ProseMirror[contenteditable="true"]'),
        getSendButton: () => {
            const container = document.querySelector('fieldset') || document.body;
            return container.querySelector('button[aria-label="Send Message"]') ||
                   Array.from(document.querySelectorAll('button')).find(b => {
                       const icon = b.querySelector('svg');
                       return icon && !b.disabled && b.offsetParent !== null;
                   });
        },
        isGenerating: () => !!document.querySelector('.result-streaming') || document.body.innerText.includes("Stop generating"),
        setValue: (el, val) => {
            el.focus();
            el.innerHTML = `<p>${val}</p>`;
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        },
        getLastMessage: () => {
             const msgs = document.querySelectorAll('.font-claude-message');
             return msgs[msgs.length - 1];
        }
    },
    GEMINI: {
        getInput: () => document.querySelector('.ql-editor') || document.querySelector('div[role="textbox"]'),
        getSendButton: () => document.querySelector('.send-button') || document.querySelector('button[aria-label="Send message"]'),
        isGenerating: () => !!document.querySelector('.run-spinner'),
        setValue: (el, val) => {
             el.focus();
             document.execCommand('insertText', false, val);
        },
        getLastMessage: () => {
            const msgs = document.querySelectorAll('message-content');
            return msgs[msgs.length - 1];
        }
    },
    UNKNOWN: {
        getInput: () => document.querySelector('textarea, input[type="text"]'),
        getSendButton: () => document.querySelector('button[type="submit"]'),
        isGenerating: () => false,
        setValue: (el, val) => setNativeValue(el, val),
        getLastMessage: () => document.body
    }
};

const Strategy = Strategies[PROVIDER];

// --- CORE LOGIC ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "INIT_AGENT") {
        console.log("[AgentAnything] Agent Initialized");
        startMonitoring();
    }
    if (msg.action === "INJECT_PROMPT") {
        injectPrompt(msg.payload);
    }
    if (msg.action === "GENESIS_MODE_ACTIVE") {
        activateGenesisMode();
    }
    if (msg.action === "DISENGAGE_LOCAL") {
        window.location.reload();
    }
});

async function injectPrompt(text) {
    const input = Strategy.getInput();
    if (!input) {
        console.error("Input element not found");
        return;
    }

    console.log("Injecting prompt...");
    Strategy.setValue(input, text);

    await new Promise(r => setTimeout(r, 100));

    const btn = Strategy.getSendButton();
    if (btn) {
        console.log("Clicking send...");
        btn.click();
    } else {
        console.warn("Send button not found, trying Enter key");
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
}

// --- GENESIS MODE ---

let isGenesisWaiting = false;

function activateGenesisMode() {
    isGenesisWaiting = true;
    console.log("GENESIS MODE ACTIVE: Waiting for user prompt...");

    const input = Strategy.getInput();
    if (input) {
        input.style.outline = "3px solid #00ff00";
        input.focus();
    }
}

function captureGenesisInput(val) {
    console.log("Genesis Input Captured:", val);
    isGenesisWaiting = false;

    // Clear UI
    const input = Strategy.getInput();
    if (input) {
        input.style.outline = "";
        Strategy.setValue(input, "");
    }

    chrome.runtime.sendMessage({ action: "GENESIS_INPUT_CAPTURED", payload: val });
}

// Global Trap
window.addEventListener('click', (e) => {
    if (!isGenesisWaiting) return;

    const btn = Strategy.getSendButton();
    // Allow clicking into input to type, trap only send button
    if (btn && (e.target === btn || btn.contains(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        const input = Strategy.getInput();
        const val = input.value || input.innerText;
        if (val && val.trim().length > 0) {
            captureGenesisInput(val);
        }
    }
}, true);

window.addEventListener('keydown', (e) => {
    if (!isGenesisWaiting) return;
    if (e.key === 'Enter' && !e.shiftKey) {
        // Check if focused element is input
        const input = Strategy.getInput();
        if (document.activeElement === input || (input && input.contains(document.activeElement))) {
             e.preventDefault();
             e.stopPropagation();
             const val = input.value || input.innerText;
             if (val && val.trim().length > 0) {
                 captureGenesisInput(val);
             }
        }
    }
}, true);


// --- MONITORING ---

const sentCommands = new Set();
let lastMessageText = "";

function startMonitoring() {
    let lastState = false; // false = idle, true = busy

    const observer = new MutationObserver(() => {
        // 1. Check Busy State
        const isBusy = Strategy.isGenerating();
        if (isBusy !== lastState) {
            lastState = isBusy;
            if (!isBusy) {
                console.log("Agent became idle.");
            }
        }

        // 2. Parse Commands from LAST message only
        const lastMsgEl = Strategy.getLastMessage();
        if (lastMsgEl) {
            const text = lastMsgEl.innerText;
            if (text !== lastMessageText) {
                lastMessageText = text;
                parseCommands(text);

                if (text.includes("[WAITING]") && !isBusy) {
                     chrome.runtime.sendMessage({ action: "AGENT_READY" });
                }
            }
        }
    });

    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-label'] });
}

function parseCommands(text) {
    // XML
    const xmlRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                console.log("Found command:", json);
                chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json });
                sentCommands.add(raw);
            } catch (e) {
                console.error("Failed to parse command:", e);
            }
        }
    }

    // JSON Code Blocks (Legacy)
    const jsonRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
    while ((match = jsonRegex.exec(text)) !== null) {
        const raw = match[1].trim();
        if (!sentCommands.has(raw)) {
            try {
                const json = JSON.parse(raw);
                if (json.tool) {
                    console.log("Found legacy command:", json);
                    chrome.runtime.sendMessage({ action: "AGENT_COMMAND", payload: json });
                    sentCommands.add(raw);
                }
            } catch (e) {}
        }
    }
}
