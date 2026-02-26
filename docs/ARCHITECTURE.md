# Architecture Reference

This document describes the internal design of AgentAnything for developers who want to understand, modify, or extend it.

---

## System Overview

AgentAnything is a Manifest V3 Chrome extension structured around a **Store-First** architecture: all persistent state lives in `chrome.storage.local`, never in service worker memory alone. This is required because MV3 service workers are ephemeral — Chrome can terminate them at any point and restart them on the next event.

The extension has three logical layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  AGENT TAB (AI chat interface)                                   │
│  ┌─────────────────┐  ┌──────────────────┐                      │
│  │  agent_bridge   │  │  agent_dashboard │                      │
│  │  (injection +   │  │  (status panel)  │                      │
│  │   monitoring)   │  │                  │                      │
│  └────────┬────────┘  └────────┬─────────┘                      │
└───────────┼────────────────────┼────────────────────────────────┘
            │  chrome.runtime    │
            │  .sendMessage      │
            ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVICE WORKER  (background.js)                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Config  │  │   State   │  │    Queue     │  │ Execution │  │
│  │  (sync)  │  │  (local)  │  │  Processor   │  │  Engine   │  │
│  └──────────┘  └───────────┘  └──────────────┘  └─────┬─────┘  │
│                                                         │       │
│  ┌──────────────────────────────────────────────────────┤       │
│  │  Saved Tools (sync)   Tab Limit enforcement          │       │
│  └──────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────┬────────┘
                                                         │
            ┌─────────────────────────────────────────────┘
            │  CDP (Chrome Debugger API)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  TARGET TAB(S) (any website)                                     │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │  target_adapter  │  │  agent_dashboard │                     │
│  │  (DOM parsing +  │  │  (status panel + │                     │
│  │   PII redaction) │  │   interaction    │                     │
│  │                  │  │   blocker)       │                     │
│  └──────────────────┘  └──────────────────┘                     │
│  ┌──────────────────┐                                           │
│  │  network_hook    │  (injected into page's main world)        │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Reference

```
AgentAnything/
├── manifest.json             Manifest V3 configuration
├── background.js             Service worker — state, queue, routing, execution
├── offscreen.html / .js      Keep-alive document (prevents SW termination)
├── popup.html / .js          Extension toolbar popup — assignment UI
├── options.html / .js        Settings page — config + saved tools management
├── welcome.html / .js        First-run privacy onboarding
└── content/
    ├── agent_bridge.js       Runs on AI tabs — injects prompts, parses responses
    ├── agent_dashboard.js    Runs on all tabs — floating status panel
    ├── target_adapter.js     Runs on all tabs — DOM scraper, PII redactor
    └── network_hook.js       Injected into page's main world — XHR/fetch hook
```

---

## Storage Schema

### `chrome.storage.sync` — persists across devices

| Key | Type | Default | Description |
|---|---|---|---|
| `privacyAccepted` | boolean | false | Whether the user has completed onboarding |
| `redactPII` | boolean | true | Whether PII is stripped before sending content to the agent |
| `debugMode` | boolean | false | Enables verbose console logging on all assigned tabs |
| `maxTabs` | number | 3 | Max simultaneous target tabs the AI can control (1–10) |
| `savedTools` | Tool[] | [] | User-defined named tool shortcuts |

**Tool object shape:**
```json
{
  "id": "1740580800000",
  "name": "Gmail",
  "url": "https://mail.google.com/mail/u/0/"
}
```
`id` is a `Date.now()` timestamp string, used as a stable identifier for deletion.

---

### `chrome.storage.local` — session state, per-device

| Key | Type | Description |
|---|---|---|
| `agentTabId` | number \| null | Chrome tab ID of the current agent tab |
| `agentUrl` | string \| null | URL of the agent tab at assignment time |
| `targetTabs` | TargetTab[] | All currently assigned target tabs |
| `commandQueue` | QueueItem[] | FIFO queue of pending commands |
| `elementMap` | object | Maps element IDs to the tab they were found in |
| `lastActionTimestamp` | number | Unix ms when last debugger action was executed |
| `observationMode` | boolean | True while waiting for the AI's intro to complete |
| `sessionKeyword` | string \| null | Unique string the AI must append to signal readiness |
| `isAgentBusy` | boolean | Reserved (not currently used) |
| `busySince` | number | Reserved (not currently used) |

**TargetTab object shape:**
```json
{ "tabId": 1234, "url": "https://example.com" }
```

**QueueItem types:**

| `type` | `payload` | Description |
|---|---|---|
| `UPDATE_AGENT` | `{ payload: string }` | Send a text update to the agent tab |
| `CLICK_TARGET` | command JSON | Execute a click or type on a target element |
| `OPEN_TAB` | `{ url: string }` | Open a URL in a new background tab and assign it |
| `OPEN_TOOL` | `{ name: string }` | Resolve a named tool to a URL, then OPEN_TAB |

---

## Service Worker (`background.js`)

### State Access

All state reads go through `getState()`, which reads from `chrome.storage.local` and applies defaults for any missing keys. All state writes go through `updateState(updates)`, which writes to storage and then calls `broadcastStatus()` to push the new status to all assigned tabs' dashboards.

### Concurrency — the State Mutex

Because multiple async operations can respond to storage events simultaneously, all multi-step read-modify-write operations are wrapped in `withLock(fn)`. This is a chained promise mutex — each call waits for the previous lock to release before running. This prevents race conditions when, for example, `processQueue` and a new `TARGET_UPDATE` message arrive at the same time.

### Keep-Alive

MV3 service workers terminate after ~30 seconds of inactivity. AgentAnything uses a hidden `offscreen.html` document (which is persistent) to keep the SW alive. Every 20 seconds, the SW sends a `ping` message to the offscreen document, which prevents the browser from terminating it. The `checkTimeout()` function also runs on each ping interval to detect stalled actions.

### Command Queue

The queue is stored in `chrome.storage.local.commandQueue`. A `storage.onChanged` listener watches this key and calls `processQueue()` whenever the queue gains new items. The `isProcessing` flag (in-memory) prevents concurrent processing. After each item completes, it is removed with a `withLock`-guarded slice, which triggers another `onChanged` event, processing the next item automatically.

### Execution Engine

Clicks and keystrokes on target tabs are executed via the **Chrome DevTools Protocol** (CDP), using `chrome.debugger`. The extension attaches to the target tab, dispatches mouse/keyboard events, and immediately detaches. This allows interaction with background (unfocused) tabs without stealing focus from the user's current tab.

For typing, the correct CDP sequence is `keyDown → char → keyUp` (not just `keyDown + keyUp`), because many web frameworks only register text from the `char` event.

### Tab Limit Enforcement

When an `OPEN_TAB` queue item is processed, the background checks `targetTabs.length` against `CONFIG.maxTabs`. If at or over the limit, the oldest entry in `targetTabs` is shifted off (FIFO), its dashboard is updated to "Idle / Released by agent", and the new tab is appended. The released browser tab is not closed.

### Pending Target Assignments

When the AI opens a tab programmatically, the tab needs time to load before content scripts are ready. The tab ID is stored in `pendingTargetAssignments` (an in-memory Map). A `chrome.tabs.onUpdated` listener watches for `status: 'complete'` on pending tabs and sends `INIT_TARGET` after an additional 600ms settle delay.

Note: `pendingTargetAssignments` is in-memory and will be lost if the service worker is terminated during a tab load. This is an acceptable edge case — the user can re-assign the target manually.

---

## Agent Bridge (`content/agent_bridge.js`)

Runs only on AI provider tabs (chatgpt.com, claude.ai, gemini.google.com, aistudio.google.com).

### Provider Detection

On load, `getProvider()` inspects `window.location.hostname` and returns one of `'chatgpt'`, `'claude'`, `'gemini'`, or `null`. All subsequent logic branches on this value using the `SELECTORS` config object.

### Observation Mode

When the Agent tab is assigned, `observationMode` is set to `true`. During this window, the bridge passively watches for the user to click and type — recording which DOM elements are used for input (`potentialSelectors.input`) and submission (`potentialSelectors.submit`). When the AI's intro response includes the `sessionKeyword`, those observed elements are promoted to `learnedSelectors`, overriding the static CSS selectors. This makes the bridge robust against UI changes — if the static selectors break, the learned ones (derived from real user interaction) continue to work.

### Input Injection Strategy

The injection approach varies by framework:

**ChatGPT (React):** Uses `_valueTracker.setValue()` to bypass React's internal synthetic event system, then dispatches `input` and `change` events. If React's tracker isn't present, a plain event dispatch is the fallback.

**Claude / Gemini (ProseMirror / contenteditable):** Three strategies in priority order:
1. `DataTransfer` + `ClipboardEvent('paste')` — ProseMirror natively intercepts paste events and handles them cleanly. This is the most reliable approach.
2. `document.execCommand('insertText')` — deprecated but still functional in Chrome as of 2026; works for simpler contenteditable targets.
3. `element.textContent = ''` + appended `<p>` with `textContent` — safe last resort. **Never uses `innerHTML`** to avoid XSS from scraped page content.

### Submit Strategy

After injecting text, the bridge polls every 100ms for the submit button. If the button becomes enabled within 5 seconds, it's clicked using a full synthetic pointer/mouse/click event sequence. If 5 seconds elapse with no enabled button, it falls back to dispatching a synthetic `Enter` keypress on the input element. If the button exists but stays disabled for over 2 seconds, the bridge re-dispatches an `input` event to try to wake the framework's form validation logic.

### Response Monitoring

A `MutationObserver` watches the full document for changes. On each mutation, it reads the text of the last assistant message element and checks:
1. Whether the `sessionKeyword` appears (signals end of Observation Mode).
2. Whether any `<tool_code>` JSON blocks or ` ```json ` code blocks are present.

Parsed command JSON is sent to the background as `AGENT_COMMAND` messages. Each unique raw command string is tracked in a `Set` (`sentCommands`) to prevent duplicate dispatch. This set is cleared on each `INIT_AGENT` to prevent leaking between sessions.

---

## Target Adapter (`content/target_adapter.js`)

Runs on all tabs but only activates when the background sends `INIT_TARGET`.

### DOM Parser

`parseDOM()` uses a `TreeWalker` to traverse the live DOM. It filters out script/style/hidden nodes and collects all interactive elements: `<a>`, `<button>`, `<input>`, `<textarea>`, `<select>`, elements with `role="button"` or `role="link"`, `contenteditable` elements, and elements with an `onclick` attribute.

Each element is assigned an incrementing integer ID, stored in the `interactables` map, and serialized to a compact XML-like representation:

```xml
<button id="4" label="Search">Search</button>
<input id="5" type="text" placeholder="Search the web...">
<a id="6" href="https://example.com/about">About Us</a>
```

Attributes included: `id`, `value`, `placeholder`, `label` (from `aria-label`, `name`, `title`, or an associated `<label>` element), `href` (path only, query string stripped), `type`, `disabled`. Inner text is truncated to 80 characters. All string values pass through `redactPII()` before serialization.

### Change Detection

A `MutationObserver` with a 500ms debounce watches for DOM changes. On each change (or immediately after a captured API call), `parseDOM()` is run, and the result is compared to `lastSnapshot`. Only when the snapshot differs is a `TARGET_UPDATE` message sent to the background. This prevents flooding the agent with identical updates.

### Network Hook

`network_hook.js` is injected as a `<script>` tag into the page's **main world** (not the isolated extension content script context) — this is required to intercept `window.fetch` and `XMLHttpRequest` before any page code has a chance to redefine them.

The hook uses `window.postMessage` with `window.location.origin` as the target origin (not `'*'`) to relay intercepted calls back to the content script. The content script validates both `event.source === window` and `event.origin === window.location.origin` before processing any message. This prevents malicious page scripts from injecting fake `AA_NETWORK_HOOK` messages.

API calls are buffered to the latest 5, appended to the DOM snapshot as an `<api_activity>` block, and included in the next `TARGET_UPDATE`.

### Element Coordinate Resolution

When the background executes a `CLICK_TARGET` command, it sends `GET_COORDINATES` to the target tab with the element ID. `target_adapter.js` looks up the element in `interactables`, calls `getBoundingClientRect()`, and returns the center coordinates. It also calls `showGreenOutline()` to briefly highlight the element with a green border (rendered via Shadow DOM to avoid disrupting the page's own CSS).

---

## Agent Dashboard (`content/agent_dashboard.js`)

Runs on all tabs. Renders a floating status panel via Shadow DOM (closed mode) so it is visually isolated from the host page's CSS.

### Interaction Blocker

When the agent is actively "Working" on a target tab, the dashboard registers capture-phase event listeners on `click`, `mousedown`, `mouseup`, `keydown`, `keypress`, `keyup`, and `submit` that call `stopImmediatePropagation()` and `preventDefault()`. This prevents accidental user interference with in-progress automation.

The blocker is **never applied to the agent tab** (`isAgentTab: true` in the dashboard update payload) because the user needs full access to read and interact with the AI chat interface.

The handler function reference is stored in the module-level `blockHandler` variable so that `removeEventListener` can correctly unregister it. (Prior to v2, a new closure was created on each call, making removal impossible.)

---

## Internal Message Protocol

All messages use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. There are no long-lived port connections.

### Content Script → Background

| `action` | Sender | Payload | Description |
|---|---|---|---|
| `HELLO` | Any tab | — | Content script announcing itself on load; background re-inits if the tab is already assigned |
| `ASSIGN_ROLE` | Popup | `{ role, tabId, task? }` | User assigns agent or target role to a tab |
| `TARGET_UPDATE` | target_adapter | `{ payload, elementIds }` | DOM snapshot ready for the agent |
| `AGENT_COMMAND` | agent_bridge | `{ action, id?, value?, url?, name? }` | Parsed command from the AI's response |
| `SAVE_TOOL` | Popup | `{ name, url }` | Save a site as a named tool |
| `DELETE_TOOL` | Options page | `{ id }` | Remove a saved tool by ID |
| `REMOTE_INJECT` | Popup | `{ payload: string }` | User-typed command to inject into the agent |
| `INTRO_COMPLETE` | agent_bridge | — | AI's intro response (with session keyword) detected |
| `USER_INTERRUPT` | target_adapter | — | User clicked or typed on a target tab |
| `DISENGAGE_ALL` | Popup | — | Clear all assignments and reset state |

### Background → Content Script

| `action` | Recipient | Payload | Description |
|---|---|---|---|
| `INIT_AGENT` | Agent tab | `{ keyword }` | Start Observation Mode with session keyword |
| `INIT_TARGET` | Target tab | `{ config }` | Activate DOM scraping and network hook |
| `EXECUTE_PROMPT` | Agent tab | `{ text }` | Inject text immediately (bypasses buffer) |
| `BUFFER_UPDATE` | Agent tab | `{ text }` | Add text to the debounce buffer |
| `GET_COORDINATES` | Target tab | `{ id }` | Request screen coordinates for an element |
| `DASHBOARD_UPDATE` | Any tab | `{ status, color, queueLength, lastAction, isAgentTab, allowInput }` | Update the floating status panel |

---

## AI Command Protocol

Commands are emitted by the AI inside `<tool_code>` XML tags as JSON objects. The `action` field determines routing.

```
<tool_code>{"action": "click", "id": 12}</tool_code>
<tool_code>{"action": "type", "id": 7, "value": "hello world"}</tool_code>
<tool_code>{"action": "open_tab", "url": "https://google.com"}</tool_code>
<tool_code>{"action": "open_tool", "name": "Gmail"}</tool_code>
```

The bridge also accepts ` ```json ` code blocks as a legacy fallback, but only processes them if the parsed object has a `tool` property (for backward compatibility with older prompt formats).

Commands are routed in `background.js` `AGENT_COMMAND` handler:
- `click` / `type` → `CLICK_TARGET` queue item → CDP execution
- `open_tab` → `OPEN_TAB` queue item → `chrome.tabs.create`
- `open_tool` → `OPEN_TOOL` queue item → tool name resolution → `OPEN_TAB`

---

## Session Lifecycle

```
Popup: ASSIGN_ROLE (AGENT)
  │
  ├─ background: generates sessionKeyword
  ├─ background: saves state, sends INIT_AGENT to agent tab
  └─ background: sends EXECUTE_PROMPT (initial system prompt, 500ms delay)
       │
       ▼
agent_bridge: injects prompt into AI input
agent_bridge: observationMode = true, watches for user clicks/focus
       │
       ▼
AI generates intro response ending with sessionKeyword
       │
       ▼
agent_bridge: detects keyword → promotes learned selectors
agent_bridge: sends INTRO_COMPLETE to background
       │
       ▼
background: observationMode = false
       │
       ▼  (on each target DOM change)
target_adapter: parseDOM() → sends TARGET_UPDATE
       │
       ▼
background: enqueues UPDATE_AGENT
       │
       ▼
background: sends BUFFER_UPDATE to agent tab
agent_bridge: debounce 500ms → injects update into AI
       │
       ▼
AI generates response with command
       │
       ▼
agent_bridge: parses command, sends AGENT_COMMAND
       │
       ▼
background: routes to CLICK_TARGET / OPEN_TAB / OPEN_TOOL
       │
       ▼
background (CLICK_TARGET): sends GET_COORDINATES to target tab
target_adapter: returns {x, y, found}
background: CDP click/type on target tab
       │
       ▼  (DOM changes after click)
target_adapter: MutationObserver → debounce → TARGET_UPDATE
       │
       └─ loop continues until DISENGAGE_ALL or no more commands
```

---

## Adding a New AI Provider

1. Add a new entry to the `SELECTORS` object in `content/agent_bridge.js`:
   ```js
   yourprovider: {
       input: 'css-selector-for-input',
       submit: 'css-selector-for-send-button',
       stop: 'css-selector-for-stop-indicator',
       lastMessage: 'css-selector-for-last-assistant-message'
   }
   ```
2. Update `getProvider()` to detect the new hostname.
3. If the provider uses a non-standard framework (not React, not ProseMirror), add a new injection strategy branch in `executePrompt()`.
4. Add the provider's URL pattern to both content script blocks in `manifest.json`.

---

## Adding a New Agent Command

1. Define the command shape in `docs/AGENT_PROTOCOL.md` (keep the AI's reference accurate).
2. Add routing in the `AGENT_COMMAND` handler in `background.js`.
3. Add the new queue item type handler inside `processQueue()`.
4. Update `buildInitialPrompt()` to include the new command in the reference injected into the AI.

---

## Known Limitations

**Service worker restart loses in-memory state:** `isProcessing`, `pendingTargetAssignments`, and `keepAliveInterval` are in-memory. If the SW is killed mid-execution, the current queue item may stall. A restart will re-trigger `processQueue` on the next `commandQueue` change, recovering naturally in most cases.

**Single command per turn:** The extension processes one queue item at a time and waits for DOM feedback before proceeding. This is intentional — it gives the AI accurate state after each action. Chaining commands without waiting for feedback leads to operating on stale element IDs.

**Selector drift:** AI chat UIs change frequently. The CSS selectors in `SELECTORS` (agent_bridge.js) will need periodic maintenance. The Observation Mode learned-selector fallback mitigates this for established sessions, but initial prompt injection requires working static selectors.

**No scroll support:** The current command set has no `scroll` action. Elements not currently in the viewport will have their coordinates returned, but a CDP click at off-screen coordinates may not work as expected on all sites. This is a planned addition.

**PII redaction is heuristic:** The regex patterns catch common US phone/email/CC formats but are not exhaustive. Unusual formats may pass through unredacted.
