# AgentAnything

> Turn one browser tab into an AI agent. Turn any other tab into its tool.

AgentAnything is a Chrome extension that connects an AI chat interface (ChatGPT, Claude, Gemini) to any other website, letting the AI browse, click, type, and navigate autonomously — without you touching a thing.

---

## How It Works

You designate two types of tabs:

- **Agent tab** — an AI chat interface (ChatGPT, Claude.ai, Gemini, or AI Studio). The extension injects browser state into this tab and reads commands back out of it.
- **Target tab(s)** — any website the AI should control. The extension scrapes these tabs, sends their content to the Agent, and executes whatever the Agent instructs.

The AI never has direct access to your browser. It receives a compressed, PII-redacted snapshot of interactive elements and responds with structured commands. The extension plays interpreter between the two.

---

## Installation

AgentAnything is a sideloaded extension (not on the Chrome Web Store).

1. Download or clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `AgentAnything` folder.
5. A privacy onboarding page will open automatically. Read it and click **I Understand & Enable** to activate the extension. The extension will not function until this step is completed.

---

## Quick Start

### Step 1 — Assign the Agent

Open an AI chat interface (e.g. [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com)). Start a new, empty conversation. Click the AgentAnything icon in your toolbar and click **ASSIGN: AGENT**.

Optionally, type a task description in the field before assigning — this gets embedded directly into the system prompt the AI receives.

### Step 2 — Assign the Target

Navigate to the website you want the AI to control. Click the extension icon and click **ASSIGN: TARGET**.

You'll be asked if you want to save this site as a **Tool** — a shortcut the AI can invoke by name in future sessions without needing you to manually open the tab first. Give it a name (e.g. "Gmail", "Google Search") or skip.

### Step 3 — Watch It Work

The Agent tab will receive a system prompt explaining its capabilities, any saved Tools, and the initial state of the Target tab. It will begin issuing commands. A small status panel appears in the corner of each assigned tab showing the current state.

### Sending Commands Mid-Session

If you need to redirect the AI or provide information while it's running, click the extension icon (the active view will show automatically) and use the **SEND COMMAND** field to inject a message directly into the agent's next prompt.

### Stopping

Click **DISENGAGE** in the active popup view, or use the Reset / Disengage link in the setup view. All tab assignments and the command queue are cleared immediately.

---

## Saved Tools

Tools are named bookmarks that let the AI open sites on demand without you having to manually navigate there first.

**Creating a tool:** Assign any tab as a Target — the popup will prompt you to save it as a Tool with a pre-filled name derived from the page title. Edit the name and press Enter (or Save), or skip.

**Managing tools:** Open **Options** (the MEMORY / CONTEXT MEMORY button in the popup, or right-click the extension icon → Options). The Tools section lists all saved tools with a Remove button for each.

**How the AI uses tools:** When you start a session, saved Tools are listed in the system prompt. The AI can open them with:
```
{"action": "open_tool", "name": "Gmail"}
```
If it uses a name that doesn't match any saved tool, it receives an error message listing the available names so it can self-correct.

---

## Tab Limit

To prevent runaway sessions from opening dozens of background tabs, you can configure the maximum number of target tabs the AI controls at any one time.

**Default:** 3 tabs.

**To change it:** Open Options and adjust the **Max simultaneous target tabs** field (1–10). The setting takes effect immediately for the next `open_tab` or `open_tool` command — no restart needed.

**What happens at the limit:** When the AI tries to open a new tab and the limit is already reached, the oldest assigned tab is automatically *released* — its browser tab stays open, but the extension stops controlling it and its status panel returns to Idle. The AI is told which tab was released.

---

## Options

Open the options page via the MEMORY button in the popup or by right-clicking the extension icon.

| Setting | Default | Description |
|---|---|---|
| Redact PII | On | Strips emails, phone numbers, and credit card numbers from page content before sending to the AI |
| Debug Mode | Off | Enables verbose `[AgentAnything]` logging in the browser console of every assigned tab |
| Max simultaneous target tabs | 3 | How many target tabs the AI may control at once (1–10) |

---

## Supported AI Providers

| Provider | URL | Notes |
|---|---|---|
| ChatGPT | chatgpt.com | Uses React-specific input injection |
| Claude | claude.ai | Uses ProseMirror-native paste injection |
| Gemini | gemini.google.com | Standard contenteditable injection |
| AI Studio | aistudio.google.com | Standard contenteditable injection |

The extension detects which provider is active by hostname and applies the appropriate injection strategy. If selectors change due to a site redesign, update the `SELECTORS` object in `content/agent_bridge.js`.

---

## Privacy

**What stays local:**
- All page scraping and PII redaction happens entirely in your browser before anything is transmitted.
- Extension settings and saved Tools are stored in `chrome.storage.sync` (synced to your Google account, never to any AgentAnything server).
- Session state is stored in `chrome.storage.local`.

**What leaves your machine:**
- Redacted page content from Target tabs is injected as text into your Agent tab's AI chat session. That content is then sent to the AI provider (OpenAI, Anthropic, Google) according to their own privacy policies.
- AgentAnything itself has no servers and transmits nothing independently.

**You are responsible for** choosing which tabs to assign as Targets. Do not use this extension on tabs containing unredacted sensitive data (banking, medical records, passwords) that you are not willing to share with your AI provider.

---

## Troubleshooting

**The AI doesn't respond to the initial prompt**

The Agent tab may still be loading. The extension sends the initial prompt 500ms after assignment. If the AI's input field wasn't ready, use SEND COMMAND from the popup to send the prompt manually.

**Commands are parsed but nothing happens on the Target tab**

The element ID the AI referenced may no longer exist — the page may have changed between the last snapshot and the command. The AI will receive a "not found" error and should re-assess. You can also check the debug panel; enable Debug Mode in Options for verbose logging.

**The status panel says "Waiting for Intro"**

Observation Mode is active. The extension is watching for the AI to complete its introductory response (which should end with the session keyword). If the AI's response was too long or got cut off before the keyword, use SEND COMMAND to send the keyword manually, or reassign the Agent tab.

**The extension stops working after browser restart**

Service worker state resets on restart by design. Re-assign the Agent and Target tabs after restarting Chrome.

**A tab was released unexpectedly**

The tab limit was reached and the oldest assigned tab was released to make room for a new one. Adjust the limit in Options, or re-assign the released tab as a Target.

---

## License

MIT
