// content/agent_bridge.js
(function() {
  if (window.__AA_BRIDGE__) return;
  window.__AA_BRIDGE__ = true;

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
    const inputSel = learnedSelectors.input || SELECTORS[PROVIDER]?.input;
    const input = findElement(inputSel);
    if (input && !input.disabled) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return true;
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
    }
  });
  attachNetwork();
})();
