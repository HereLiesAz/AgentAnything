# Contributing & Development Guide

---

## Dev Environment Setup

No build step required. AgentAnything is plain JavaScript — no bundler, no transpiler, no `node_modules`. The only tooling is a Node.js test runner for the background logic unit tests.

```bash
# Clone the repo
git clone https://github.com/HereLiesAz/AgentAnything.git
cd AgentAnything

# Run the unit tests (requires Node.js)
node tests/background_test.js
```

### Loading the Extension for Development

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the repo root
4. Make code changes
5. Click the **⟳ reload** button on the extension card (or press R on `chrome://extensions`)

Content script changes take effect on the next page load of the target tab. Background script changes take effect immediately after reload.

### Debugging

**Background (service worker):** On `chrome://extensions`, click **Service Worker** next to the extension. This opens a DevTools window for the background script.

**Content scripts:** Open DevTools on the Agent or Target tab and look for `[AgentAnything]` prefixed log lines. Enable **Debug Mode** in Options for verbose output.

**State inspection:** In the background DevTools console:
```js
chrome.storage.local.get(null, console.log)   // full session state
chrome.storage.sync.get(null, console.log)    // config + saved tools
```

**Manually trigger a DOM snapshot:** In any target tab's DevTools console:
```js
chrome.runtime.sendMessage({ action: "INIT_TARGET", config: {} })
```

---

## Project Conventions

### Storage

- **Never** read from or write to `chrome.storage.session` for state — it's reserved for cross-context access level configuration only.
- All session state lives in `chrome.storage.local`. All user config and saved tools live in `chrome.storage.sync`.
- Always use `getState()` to read, `updateState()` to write. Never call `chrome.storage.local.get/set` directly in message handlers.
- Multi-step state mutations must be wrapped in `withLock()`.

### Messages

- All messages are fire-and-forget via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. No persistent ports.
- Every `onMessage.addListener` callback returns `true` to signal async intent.
- Content scripts must guard `chrome.runtime?.id` before sending messages — the runtime can become unavailable if the extension is reloaded while the tab is open.

### Content Scripts

- All content scripts wrap their logic in an IIFE `(function() { ... })()` to avoid polluting the global scope.
- Shadow DOM (`attachShadow`) is used for all injected UI (dashboard, overlay) to isolate styles from the host page.
- **Never use `innerHTML`** with content derived from page text. Always use `textContent` or build elements programmatically.

### Error Handling

- Wrap all CDP (`chrome.debugger`) calls in try/catch/finally. Always call `chrome.debugger.detach` in `finally`.
- Silent errors in helper functions (e.g. `sendMessageToTab`) are acceptable — tabs can be closed or not yet ready. Log with `log()` (debug-mode-gated), not `console.error`.
- User-visible errors should be sent back to the agent as `UPDATE_AGENT` queue items so the AI can self-correct rather than silently stalling.

---

## Key Extension Points

### Adding a New AI Provider

See [ARCHITECTURE.md → Adding a New AI Provider](./ARCHITECTURE.md#adding-a-new-ai-provider).

Short version: add to `SELECTORS` in `agent_bridge.js`, update `getProvider()`, add the URL to `manifest.json` content_scripts, add an injection strategy branch if needed.

### Adding a New Command

See [ARCHITECTURE.md → Adding a New Agent Command](./ARCHITECTURE.md#adding-a-new-agent-command).

Short version: add routing in `AGENT_COMMAND` handler, add queue item processing in `processQueue()`, update `buildInitialPrompt()` to document it in the system prompt.

### Modifying the System Prompt

`buildInitialPrompt()` is at the bottom of `background.js`. It reads saved tools and `CONFIG.maxTabs` dynamically. The structure is:
1. Role declaration
2. Command reference (always present)
3. Available tools section (omitted if no tools saved)
4. Constraints (tab limit, action cadence)
5. Goal (omitted if no task provided)
6. Session keyword instruction

Changes here affect every new session immediately.

---

## Chrome Web Store Submission Notes

### Required Justifications

Two sensitive permissions require written justification during CWS review:

**`debugger` permission:**
> Required to dispatch synthetic mouse and keyboard events (clicks, keystrokes) to background browser tabs without stealing focus from the user's current tab. The Chrome DevTools Protocol is the only available mechanism for input injection in background tabs in Manifest V3.

**`<all_urls>` host permission:**
> Required to inject content scripts into any user-designated target tab. The extension cannot know in advance which websites the user will choose to automate — the target site is chosen at runtime by the user.

### Privacy Policy

A privacy policy is required for CWS submission. Key points to cover:
- No data is collected or transmitted by AgentAnything itself.
- Page content from target tabs is processed locally (PII redacted) and injected into the user's own AI chat session.
- That content is then subject to the AI provider's (OpenAI, Anthropic, Google) own privacy policy.
- Extension settings and saved Tools are stored in `chrome.storage.sync`, which syncs to the user's Google account.

### Version Numbering

Follow semver. The current version is `1.0.0`. Increment the patch version (`1.0.x`) for bug fixes and selector updates. Increment minor (`1.x.0`) for new features or new provider support. Increment major for breaking changes to the command protocol or storage schema.

---

## Running Tests

```bash
node tests/background_test.js
```

The test file mocks `chrome.storage` and exercises the queue timeout logic and interrupt handling directly, without needing a browser. Extend it by adding test cases to `runTests()`.

`tests/test_api.html` is a standalone HTML file for manually testing the network hook. Load it in a browser and open DevTools to observe captured XHR/fetch calls.

---

## What's Not Here (Planned)

- **`scroll` command** — Scroll the target tab viewport or a specific element. Needed for pages where target elements are below the fold.
- **`navigate` command** — Navigate the current target tab to a new URL without opening a new tab, for linear workflows.
- **`wait` command** — Explicit pause for a specified number of milliseconds, for pages with animation or delayed rendering.
- **Frame support** — Elements inside `<iframe>` elements are not currently scraped. Requires injecting `target_adapter.js` into frames separately.
- **Screenshot command** — Return a base64 screenshot of the target tab via CDP `Page.captureScreenshot`, for visual verification steps.
