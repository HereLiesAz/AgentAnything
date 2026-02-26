# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2026-02-26

First production-ready release. Major refactor from the prototype (0.24.x series).

### Fixed — Critical

- **Popup read wrong storage area and key.** `popup.js` was reading `chrome.storage.session` instead of `chrome.storage.local`, and using the key `targetTabIds` instead of the actual key `targetTabs`. The popup always showed the setup view regardless of actual session state.
- **SEND COMMAND button did nothing.** The `REMOTE_INJECT` message had no handler in `background.js`. Added the handler — it now forwards the command to the agent tab as `EXECUTE_PROMPT`.
- **Interaction blocker could never be disabled.** `blockInteractions()` created a new closure on each call. `removeEventListener` requires the same function reference; the different object meant interactions were permanently blocked once enabled. Fixed by storing the handler reference at module scope.
- **`agent_dashboard.js` double-injected on AI tabs.** The file appeared in both the `<all_urls>` and AI-specific content script blocks in `manifest.json`, causing two dashboards and two message listeners on ChatGPT, Claude, and Gemini tabs.
- **Tab URLs never saved correctly.** `sender.tab` is `null` for messages sent from the popup (not a content script), so `sender.tab?.url` was always `undefined`. Agent and target URLs were stored as empty strings, breaking the tab recovery logic. Fixed using `chrome.tabs.get(tabId)`.
- **XSS vulnerability in ProseMirror injection.** The `setContentEditableValue` fallback used `element.innerHTML = \`<p>${value}</p>\``. If `value` contained HTML from a scraped page, it would be executed in the AI tab. Replaced with `DataTransfer` paste (primary), `execCommand` (secondary), and `textContent` assignment (last resort — no HTML injection possible).
- **Agent tab interactions were blocked.** The interaction blocker in `agent_dashboard.js` was applied to all tabs including the Agent (AI chat) tab, making it impossible for the user to read or interact with the AI interface during active sessions.

### Fixed — High

- **`sentCommands` Set memory leak.** The Set that tracks dispatched commands was never cleared between sessions, growing without bound. Now cleared on `INIT_AGENT`.
- **`network_hook.js` message spoofing.** `window.postMessage` was called with target origin `'*'`, allowing any page script to inject fake `AA_NETWORK_HOOK` messages. Now uses `window.location.origin`. `target_adapter.js` validates origin before processing.
- **`isBusy()` was ChatGPT-specific.** The fallback `document.querySelector('.result-streaming')` is a ChatGPT class name. On Claude and Gemini it never matched, meaning updates could be injected while the AI was still generating. Now uses provider-specific stop selectors and an `aria-label` fallback.
- **`alert()` in `welcome.js`.** Replaced with inline DOM feedback and auto-close after 2.5 seconds.
- **Tab auto-recovery.** Removed aggressive behavior of opening new tabs when agent or target tabs were closed by the user. Now just clears the assignment.

### Fixed — Medium

- **`chrome.storage.session.setAccessLevel` only called on install.** Session storage is wiped on browser restart, so the access level must be re-applied on every service worker start. Moved to the top level of `background.js`.
- **Popup used stale `store.agentTabId` in SEND COMMAND handler.** The value was captured at DOMContentLoaded and could be stale. The handler now re-reads state from storage before sending.
- **CDP `type` command used wrong key event sequence.** The `keyUp` event had no `text` or `key` properties. Corrected to `keyDown → char → keyUp` with proper field population.

### Added

- **Saved Tools.** Users can save any assigned target site as a named tool. The popup prompts after target assignment with a pre-filled name derived from the page title. Tools are stored in `chrome.storage.sync`. The AI receives the full tool list in its system prompt and can open them with `{"action": "open_tool", "name": "..."}`.
- **Tab limit.** Configurable maximum number of simultaneously controlled target tabs (default 3, range 1–10). Set in Options. When the limit is reached, the oldest tab is released (not closed) to make room.
- **`open_tab` command.** The AI can open any URL in a new background tab with `{"action": "open_tab", "url": "..."}`. The tab is automatically initialized as a target when it finishes loading.
- **`open_tool` command.** Opens a saved tool by name. Resolves to `open_tab` internally. Returns an error with available names if the tool isn't found.
- **Tool management in Options.** The options page now lists all saved tools with individual remove buttons and re-renders live when tools change.
- **`isAgentTab` flag in dashboard updates.** Allows the dashboard to correctly distinguish agent from target tabs and avoid blocking interaction on the agent side.
- **`buildInitialPrompt()` function.** Centralizes system prompt construction. Dynamically includes saved tools, tab limit, and task description.
- **Comprehensive documentation.** `readme.md` (user guide), `docs/ARCHITECTURE.md` (technical reference), `docs/AGENT_PROTOCOL.md` (command reference), `docs/CONTRIBUTING.md` (developer guide), `docs/CHANGELOG.md` (this file).

### Changed

- Version bumped from `0.24.3` to `1.0.0`.
- `AGENT_COMMAND` routing now branches on `cmd.action` field to support `open_tab` and `open_tool` alongside `click` and `type`.
- Tab cleanup on tab close no longer attempts to reopen tabs; it just clears the assignment from state.
- `broadcastStatus()` no longer accepts a `changes` parameter; it reads fresh state each call.
- `agent_dashboard.js` removed from the AI-specific content script block in `manifest.json` (it remains in the `<all_urls>` block).

---

## [0.24.3] — 2026-02-25 (prototype)

Final state before production refactor. Working prototype with known issues documented in `PRODUCTION_AUDIT.md`.

### Known Issues at This Version
- Popup permanently broken due to wrong storage key
- SEND COMMAND button non-functional
- XSS vulnerability in Claude input injection
- Interaction blocker permanently enabled once triggered
- Agent tab interactions blocked
- Tab URLs never persisted correctly
- Dashboard double-injected on AI tabs
