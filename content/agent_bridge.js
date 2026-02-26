// content/agent_bridge.js
(function() {
  if (window.__AA_BRIDGE__) return;
  window.__AA_BRIDGE__ = true;

<<<<<<< HEAD
  const DEBUG = false; // set true for logs
  const log = (...args) => DEBUG && console.log('[AgentBridge]', ...args);

  const PROVIDER = (() => {
    const host = location.hostname;
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('aistudio.google.com')) return 'aistudio';
    return null;
  })();

  const SELECTORS = {
    chatgpt: {
      input: 'textarea[placeholder*="Message ChatGPT"], textarea[placeholder*="Send a message"]',
      submit: 'button[data-testid="send-button"], button[class*="send"]',
      stop: 'button[aria-label*="Stop"]',
      lastMessage: '[data-message-author-role="assistant"]:last-child'
    },
    claude: {
      input: 'div[contenteditable="true"][class*="ProseMirror"]',
      submit: 'button[aria-label*="Send"]',
      stop: 'button[aria-label*="Stop"]',
      lastMessage: 'div[class*="font-claude-message"]:last-child'
    },
    gemini: {
      input: 'div[contenteditable="true"][role="textbox"]',
      submit: 'button[aria-label*="Send"]',
      stop: 'button[aria-label*="Stop"]',
      lastMessage: 'div[class*="model-response"]:last-child'
    },
    aistudio: {
      input: 'div[contenteditable="true"][role="textbox"]',
      submit: 'button[aria-label*="Send"]',
      stop: 'button[aria-label*="Stop"]',
      lastMessage: 'div[class*="response"]:last-child'
=======
// --- 1. Selector Config ---
const SELECTORS = {
    chatgpt: {
        input: '#prompt-textarea',
        submit: 'button[data-testid="send-button"]',
        stop: 'button[aria-label="Stop generating"], button[data-testid="stop-button"]',
        lastMessage: 'div[data-message-author-role="assistant"]:last-of-type'
    },
    claude: {
        input: '.ProseMirror[contenteditable="true"], div[contenteditable="true"][data-placeholder]',
        submit: 'button[aria-label="Send Message"], button[data-testid="send-button"]',
        stop: 'button[aria-label="Stop Response"], .font-claude-message ~ div button[aria-label]',
        lastMessage: '.font-claude-message:last-of-type, [data-is-streaming] ~ * .font-claude-message:last-of-type'
    },
    gemini: {
        input: '.ql-editor, div[contenteditable="true"]',
        submit: '.send-button, button[aria-label="Send message"]',
        stop: '.run-spinner, [aria-label="Stop response"]',
        lastMessage: 'message-content:last-of-type, .response-container:last-of-type'
>>>>>>> parent of d606fb1 (boof)
    }
  };

  let observationMode = false;
  let sessionKeyword = null;
  let learnedSelectors = { input: null, submit: null };
  let sentCommands = new Set();
  let bufferTimer = null;
  const BUFFER_DELAY = 500;

  function findElement(selector) {
    return selector ? document.querySelector(selector) : null;
  }

  function injectText(element, text) {
    if (!element) return false;
    const p = PROVIDER;

    if (p === 'chatgpt') {
      try {
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue(text);
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (e) { log(e); return false; }
    }

    if (p === 'claude' || p === 'gemini' || p === 'aistudio') {
      try {
        element.focus();
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
        paste.clipboardData.setData('text/plain', text);
        element.dispatchEvent(paste);
        return true;
      } catch (e) {
        try {
          element.focus();
          document.execCommand('insertText', false, text);
          return true;
        } catch (e2) {
          try {
            element.textContent = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          } catch (e3) { log(e3); }
        }
      }
    }

    try {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) { log(e); return false; }
  }

  async function submitMessage() {
    const submitSel = learnedSelectors.submit || SELECTORS[PROVIDER]?.submit;
    const btn = findElement(submitSel);
    if (btn && !btn.disabled) {
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      });
      return true;
    }
<<<<<<< HEAD
    const inputSel = learnedSelectors.input || SELECTORS[PROVIDER]?.input;
    const input = findElement(inputSel);
    if (input && !input.disabled) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return true;
=======

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
// FIX: Previous code had ChatGPT-specific .result-streaming as a fallback on all providers.
//      Now checks provider-specific selectors properly.
function isBusy() {
    const config = SELECTORS[PROVIDER];
    if (!config) return false;
    if (config.stop && document.querySelector(config.stop)) return true;
    // Aria-based fallback: look for any "Stop" button that's visible
    const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"]');
    if (stopBtn && stopBtn.offsetParent !== null) return true;
    return false;
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
>>>>>>> parent of d606fb1 (boof)
    }
    return false;
  }

  function executePrompt(text) {
    const inputSel = learnedSelectors.input || SELECTORS[PROVIDER]?.input;
    const input = findElement(inputSel);
    if (!input) return false;

    if (PROVIDER === 'chatgpt') input.value = '';
    else if (PROVIDER === 'claude' || PROVIDER === 'gemini' || PROVIDER === 'aistudio') input.textContent = '';

    if (!injectText(input, text)) return false;
    setTimeout(submitMessage, 100);
    return true;
  }

  function bufferUpdate(text) {
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => {
      executePrompt(text);
      bufferTimer = null;
    }, BUFFER_DELAY);
  }

  function monitorResponses() {
    const lastMsgSel = SELECTORS[PROVIDER]?.lastMessage;
    if (!lastMsgSel) return;
    let lastText = '';
    const obs = new MutationObserver(() => {
      const last = document.querySelector(lastMsgSel);
      if (!last) return;
      const text = last.textContent || '';
      if (text === lastText) return;
      lastText = text;

<<<<<<< HEAD
      if (observationMode && sessionKeyword && text.includes(sessionKeyword)) {
        observationMode = false;
        chrome.runtime.sendMessage({ action: 'INTRO_COMPLETE' }).catch(() => {});
      }

      const toolMatch = text.match(/<tool_code>([\s\S]*?)<\/tool_code>/);
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      let raw = null;
      if (toolMatch) raw = toolMatch[1].trim();
      else if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (parsed.tool) raw = jsonMatch[1].trim();
        } catch (_) {}
      }
      if (raw && !sentCommands.has(raw)) {
        sentCommands.add(raw);
        try {
          const cmd = JSON.parse(raw);
          chrome.runtime.sendMessage({ action: 'AGENT_COMMAND', ...cmd }).catch(() => {});
        } catch (e) { log('Parse error', e); }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'INIT_AGENT') {
      observationMode = true;
      sessionKeyword = msg.keyword;
      sentCommands.clear();
      monitorResponses();
    }
    if (msg.action === 'EXECUTE_PROMPT') executePrompt(msg.text);
    if (msg.action === 'BUFFER_UPDATE') bufferUpdate(msg.text);
  });

  // Network hook (optional, from original)
  let networkAttached = false;
  function safeSend(m) { try { if (chrome?.runtime?.id) chrome.runtime.sendMessage(m).catch(()=>{}); } catch(_){} }
  function attachNetwork() { if (!networkAttached) { safeSend({type:'AA_ATTACH_NETWORK'}); networkAttached=true; } }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AA_NETWORK_REQUEST' || msg.type === 'AA_NETWORK_BODY') {
      window.postMessage({ source: 'AA_CDP', ...msg }, location.origin);
=======
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
        } else {
            if (elapsed > 5000) {
                clearInterval(interval);
                console.warn("[AgentAnything] Button not ready after 5s, forcing Enter key");
                const eventOpts = { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, view: window, composed: true };
                inputEl.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
                inputEl.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
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
    let lastState = false;

    const observer = new MutationObserver(() => {
        const busy = isBusy();
        if (busy !== lastState) {
            lastState = busy;
            if (!busy) {
                console.log("[AgentAnything] Agent became idle.");
            }
        }

        const config = SELECTORS[PROVIDER];
        if (!config || !config.lastMessage) return;

        const lastMsgEl = document.querySelector(config.lastMessage);

        if (lastMsgEl) {
            const text = lastMsgEl.innerText;
            if (text !== lastMessageText) {
                lastMessageText = text;

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
        }
    });

    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-label'] });
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
>>>>>>> parent of d606fb1 (boof)
    }
  });
  attachNetwork();
})();
