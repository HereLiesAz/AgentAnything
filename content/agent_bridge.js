// content/agent_bridge.js
(function() {
  if (window.__AA_BRIDGE__) return;
  window.__AA_BRIDGE__ = true;

  // -------------------- Configuration --------------------
  const DEBUG = false; // set to true to see verbose logs
  const log = (...args) => DEBUG && console.log('[AgentBridge]', ...args);

  // Provider detection
  const PROVIDER = (() => {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('aistudio.google.com')) return 'aistudio';
    return null;
  })();

  // CSS selectors for each provider (update as needed)
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
    }
  };

  // -------------------- State --------------------
  let observationMode = false;
  let sessionKeyword = null;
  let learnedSelectors = { input: null, submit: null };
  let sentCommands = new Set(); // deduplicate raw command strings
  let bufferTimer = null;
  const BUFFER_DELAY = 500; // ms

  // -------------------- Helper: find element --------------------
  function findElement(selector) {
    if (!selector) return null;
    return document.querySelector(selector);
  }

  // -------------------- Provider-specific injection --------------------
  function injectText(element, text) {
    if (!element) return false;
    const provider = PROVIDER;

    // ChatGPT (React)
    if (provider === 'chatgpt') {
      try {
        // React uses a value tracker
        const tracker = element._valueTracker;
        if (tracker) {
          tracker.setValue(text);
        }
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (e) {
        log('ChatGPT injection failed', e);
        return false;
      }
    }

    // Claude / Gemini / AI Studio (ProseMirror / contenteditable)
    if (provider === 'claude' || provider === 'gemini' || provider === 'aistudio') {
      // Strategy 1: Paste via DataTransfer (best for ProseMirror)
      try {
        element.focus();
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData.setData('text/plain', text);
        element.dispatchEvent(pasteEvent);
        return true;
      } catch (e) {
        log('Paste injection failed, trying execCommand', e);
      }

      // Strategy 2: execCommand (fallback)
      try {
        element.focus();
        document.execCommand('insertText', false, text);
        return true;
      } catch (e) {
        log('execCommand failed', e);
      }

      // Strategy 3: textContent (safe, no HTML)
      try {
        element.textContent = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      } catch (e) {
        log('textContent fallback failed', e);
      }
      return false;
    }

    // Generic fallback
    try {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      log('Generic injection failed', e);
      return false;
    }
  }

  // -------------------- Submit the message --------------------
  async function submitMessage() {
    const provider = PROVIDER;
    const submitSelector = learnedSelectors.submit || SELECTORS[provider]?.submit;
    if (!submitSelector) return false;

    // Try clicking the submit button
    const btn = findElement(submitSelector);
    if (btn && !btn.disabled) {
      // Dispatch a full pointer/click sequence
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
      return true;
    }

    // If no enabled button, try pressing Enter on the input field
    const inputSelector = learnedSelectors.input || SELECTORS[provider]?.input;
    const input = findElement(inputSelector);
    if (input && !input.disabled) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return true;
    }
    return false;
  }

  // -------------------- Inject a prompt (used by EXECUTE_PROMPT) --------------------
  function executePrompt(text) {
    const provider = PROVIDER;
    if (!provider) return false;

    const inputSelector = learnedSelectors.input || SELECTORS[provider]?.input;
    const input = findElement(inputSelector);
    if (!input) return false;

    // Clear any existing content (only if needed)
    if (provider === 'chatgpt') {
      input.value = '';
    } else if (provider === 'claude' || provider === 'gemini' || provider === 'aistudio') {
      // For contenteditable, clear safely
      input.textContent = '';
    }

    // Inject the new text
    if (!injectText(input, text)) return false;

    // Wait a tiny moment for the UI to update, then submit
    setTimeout(() => {
      submitMessage();
    }, 100);
    return true;
  }

  // -------------------- Buffer updates (avoid flooding) --------------------
  function bufferUpdate(text) {
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => {
      executePrompt(text);
      bufferTimer = null;
    }, BUFFER_DELAY);
  }

  // -------------------- Response monitoring --------------------
  function monitorResponses() {
    const provider = PROVIDER;
    if (!provider) return;

    const lastMessageSelector = SELECTORS[provider]?.lastMessage;
    if (!lastMessageSelector) return;

    let lastMessageText = '';

    const observer = new MutationObserver(() => {
      const lastMsg = document.querySelector(lastMessageSelector);
      if (!lastMsg) return;

      const text = lastMsg.textContent || '';
      if (text === lastMessageText) return;
      lastMessageText = text;

      // Check for session keyword (ends observation mode)
      if (observationMode && sessionKeyword && text.includes(sessionKeyword)) {
        observationMode = false;
        chrome.runtime.sendMessage({ action: 'INTRO_COMPLETE' }).catch(() => {});
        // Promote learned selectors if we haven't already
        if (!learnedSelectors.input && lastMsg) {
          // Try to infer input and submit selectors from the last user interaction
          // This is simplified – you could store them during observation
        }
      }

      // Extract command from <tool_code> or ```json
      const toolCodeMatch = text.match(/<tool_code>([\s\S]*?)<\/tool_code>/);
      const jsonBlockMatch = text.match(/```json\n([\s\S]*?)\n```/);
      let rawCommand = null;

      if (toolCodeMatch) {
        rawCommand = toolCodeMatch[1].trim();
      } else if (jsonBlockMatch) {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        if (parsed.tool) rawCommand = jsonBlockMatch[1].trim(); // legacy
      }

      if (rawCommand && !sentCommands.has(rawCommand)) {
        sentCommands.add(rawCommand);
        try {
          const cmd = JSON.parse(rawCommand);
          chrome.runtime.sendMessage({ action: 'AGENT_COMMAND', ...cmd }).catch(() => {});
        } catch (e) {
          log('Failed to parse command', rawCommand, e);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // -------------------- Listen for messages from background --------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'INIT_AGENT') {
      observationMode = true;
      sessionKeyword = msg.keyword;
      sentCommands.clear(); // fresh session
      // Start observing responses
      monitorResponses();
      log('Agent initialized, keyword:', sessionKeyword);
    }

    if (msg.action === 'EXECUTE_PROMPT') {
      executePrompt(msg.text);
    }

    if (msg.action === 'BUFFER_UPDATE') {
      bufferUpdate(msg.text);
    }
  });

  // -------------------- Network hook (already present) --------------------
  let networkAttached = false;

  function safeSend(message) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (_) {}
  }

  function attachNetwork() {
    if (networkAttached) return;
    safeSend({ type: 'AA_ATTACH_NETWORK' });
    networkAttached = true;
  }

  function detachNetwork() {
    if (!networkAttached) return;
    safeSend({ type: 'AA_DETACH_NETWORK' });
    networkAttached = false;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AA_NETWORK_REQUEST' || message.type === 'AA_NETWORK_BODY') {
      window.postMessage({ source: 'AA_CDP', ...message }, window.location.origin);
    }
  });

  attachNetwork();

  // DO NOT use beforeunload
})();
