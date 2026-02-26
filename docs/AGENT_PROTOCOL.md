# Agent Command Protocol

This document defines the command format the AI agent uses to control browser tabs. It is the authoritative reference for what commands exist, what they do, and how to extend the system.

---

## Command Format

The AI must output commands as JSON inside `<tool_code>` XML tags:

```
<tool_code>{"action": "...", ...}</tool_code>
```

Rules:
- One command per response turn.
- The command must be valid JSON. Extra whitespace inside the tags is fine.
- The AI must wait for the next DOM snapshot before issuing another command.
- Every response must end with the session keyword provided in the system prompt.

A legacy ` ```json ``` ` code block format is also accepted, but only if the parsed object contains a `"tool"` property. The `<tool_code>` format is preferred.

---

## Commands

### `click`

Click a numbered interactive element on a target tab.

```json
{"action": "click", "id": 12}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `"click"` |
| `id` | number | yes | The element ID from the most recent DOM snapshot |

The click is executed via Chrome's DevTools Protocol (`Input.dispatchMouseEvent`) at the center coordinates of the element. The target tab does not need to be in focus.

**When to use:** Buttons, links, checkboxes, dropdowns, tabs — any element listed in the snapshot that you want to activate.

**Common errors:**
- `Element ID X not found` — The element no longer exists (the page changed). Request a fresh snapshot by sending any message that produces a DOM update, then re-issue with the new ID.

---

### `type`

Click an input element and type a string into it.

```json
{"action": "type", "id": 7, "value": "hello world"}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `"type"` |
| `id` | number | yes | The element ID of the input, textarea, or contenteditable field |
| `value` | string | yes | The text to type |

The element is clicked first to focus it, then each character is dispatched individually as `keyDown → char → keyUp` events via CDP.

**When to use:** Text inputs, search boxes, form fields, textarea elements.

**Note:** This replaces the field contents only if the underlying framework handles key events that way. To clear a field first, click the element, then issue a type command with an empty string, then issue a type with the desired value.

---

### `open_tab`

Open a URL in a new background tab and register it as a target.

```json
{"action": "open_tab", "url": "https://www.google.com/search?q=weather"}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `"open_tab"` |
| `url` | string | yes | The full URL to open, including protocol |

The new tab loads in the background without stealing focus from the current view. When the page finishes loading, it is automatically initialized as a target tab and will begin sending DOM snapshots.

If the tab limit is already reached, the oldest currently-assigned target tab is released before the new one is opened. The agent is notified which tab was released.

**When to use:** Navigating to a new site, opening a search results page, accessing a web resource that isn't in the current target tab.

---

### `open_tool`

Open a saved Tool by name.

```json
{"action": "open_tool", "name": "Gmail"}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `"open_tool"` |
| `name` | string | yes | The exact name of a saved Tool (case-insensitive) |

Tools are named shortcuts the user saves for frequently-used sites. The name is resolved to a URL and then treated identically to `open_tab` — a new background tab is opened, subject to the same tab limit rules.

If the name doesn't match any saved tool, the agent receives an error listing all available tool names. The agent should correct the name or fall back to `open_tab` with the known URL.

**When to use:** Opening a frequently-used site the user has pre-configured, without needing to know or construct the full URL.

---

## System Messages

The extension sends structured feedback to the agent automatically. The agent should interpret these and adjust behavior accordingly.

### DOM Snapshot

Sent after every meaningful DOM change on any target tab.

```xml
<browsing_context>
[Target Update]
URL: https://example.com/results

Interactive Elements:
<a id="1" href="https://example.com/about">About Us</a>
<button id="2" label="Search">Search</button>
<input id="3" type="text" placeholder="Search..." value="">
<button id="4" label="Submit" disabled="true">Submit</button>
<textarea id="5" label="Message"></textarea>
</browsing_context>
```

Element attributes present:
- `id` — Use this number in click/type commands
- `label` — Derived from `aria-label`, `name`, `title`, or associated `<label>` text
- `value` — Current field value (PII-redacted if enabled)
- `placeholder` — Input hint text
- `href` — Link destination (query string stripped)
- `type` — Input type (text, checkbox, submit, etc.)
- `disabled` — Present if the element is currently non-interactive

When multiple target tabs are active, each sends its own snapshot independently. Snapshots from different tabs are distinguished by their `URL:` line.

### API Activity

When the target page makes XHR or fetch calls, they are appended to the next snapshot:

```xml
<api_activity>
  <call method="POST" url="/api/search">
    {"query":"weather today"}
  </call>
</api_activity>
```

This gives the agent visibility into what the page is doing in the background, which is useful for understanding navigation state and waiting for async operations.

### Action Timeout

If 15 seconds pass after an action with no detected DOM change:

```
System: Action executed but no DOM change detected within 15 seconds.
```

The agent should re-assess. Possible causes: the click didn't register, the page requires a scroll to reach the element, the element is inside a frame, or the action had no visible effect and a different approach is needed.

### Execution Errors

```
System Error: Element ID 12 not found.
System Error: Failed to open URL "https://...". [reason]
System Error: Tool "Outlook" not found. Available tools: "Gmail", "Google Docs"
```

The agent should treat these as recoverable errors and try an alternative approach.

### Tab Released

```
System: Tab limit (3) reached. Released tab: https://example.com
```

The agent should note that this tab is no longer available and adjust its plan accordingly.

---

## Example Session Transcript

**Initial system prompt (injected automatically):**
```
You are an autonomous web agent. An extension feeds you live browser state and executes your commands.

═══ COMMAND REFERENCE ═══
Output ONE command at a time as JSON inside <tool_code> tags:

  Click an element:       <tool_code>{"action": "click", "id": <number>}</tool_code>
  Type into a field:      <tool_code>{"action": "type", "id": <number>, "value": "<text>"}</tool_code>
  Open a URL (new tab):   <tool_code>{"action": "open_tab", "url": "<full URL>"}</tool_code>
  Open a saved Tool:      <tool_code>{"action": "open_tool", "name": "<exact tool name>"}</tool_code>

═══ AVAILABLE TOOLS ═══
  • Google Search          → https://google.com
  • Hacker News            → https://news.ycombinator.com

═══ CONSTRAINTS ═══
• You may control up to 3 tabs simultaneously.
• When you open a new tab at the limit, the oldest tab is automatically released.
• After every action you will receive updated DOM snapshots of all active target tabs.
• Interactive elements in each snapshot are numbered — use those numbers as "id" values.
• Wait for a DOM update before issuing the next command; do not chain multiple commands at once.

═══ YOUR GOAL ═══
Find the top Hacker News story today and search for related discussions on Google.

IMPORTANT: End EVERY response with this exact keyword: [END:news.ycombinator.com-claude.ai-1740580800000]
```

**AI intro (observation mode):**
```
Understood. I'll begin by opening Hacker News to find today's top story.

<tool_code>{"action": "open_tool", "name": "Hacker News"}</tool_code>

[END:news.ycombinator.com-claude.ai-1740580800000]
```

**Extension: DOM snapshot arrives from the new tab.**

**AI:**
```
I can see the Hacker News front page. The top story is element id 3.
Let me read the title before searching.

The top story appears to be "Show HN: We built a local-first sync engine".
Now I'll search Google for related discussions.

<tool_code>{"action": "open_tool", "name": "Google Search"}</tool_code>

[END:news.ycombinator.com-claude.ai-1740580800000]
```

**Extension: Google loads as a new target tab.**

**AI:**
```
Google is ready. I'll type the search query now.

<tool_code>{"action": "type", "id": 2, "value": "local-first sync engine site:news.ycombinator.com OR site:reddit.com"}</tool_code>

[END:news.ycombinator.com-claude.ai-1740580800000]
```

**Extension: DOM updates after typing.**

**AI:**
```
Query entered. Submitting the search.

<tool_code>{"action": "click", "id": 5}</tool_code>

[END:news.ycombinator.com-claude.ai-1740580800000]
```

---

## Prompt Engineering Tips

**Be specific about the goal.** The task description is embedded directly in the system prompt. "Find the cheapest round-trip flight from NYC to London in March" will produce better results than "find a flight".

**Pre-save frequently used tools.** The AI performs more reliably when it can use `open_tool` with a known URL rather than constructing navigation from scratch. Tools for Google Search, Wikipedia, news sites, and internal tools are high-value candidates.

**Set a realistic tab limit.** Most tasks need only 1–2 target tabs. Setting `maxTabs` to 5+ for a complex multi-site research task is fine, but higher limits also mean more snapshot data per turn, which can fill context windows faster.

**Use SEND COMMAND to redirect.** If the AI goes down a wrong path, you don't need to stop and restart the session. Type a correction in the popup's SEND COMMAND field and hit Enter. It will be injected as the next prompt.
