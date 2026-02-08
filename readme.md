# AgentAnything

> "Turn one tab into the Agent, another tab into its tool."

**AgentAnything** is a Chrome Extension that facilitates the enslavement of one browser tab by another. It transforms a standard browsing session into a master-slave architecture, allowing an AI (running in the **Agent** tab) to programmatically control, read, and manipulate any other website (the **Target** tab) via a generated JSON protocol.

This is not a "copilot." This is a puppet master.

## 💀 Features

* **Heuristic Engine:** Traverses the DOM (including Shadow Roots) to score and identify interactive elements based on utility, centrality, and type. It ignores the noise and maps the signal.
* **Diff Engine:** Minimizes token usage by caching the Target's state and only transmitting *deltas* (appends or replacements) to the Agent. Bandwidth is finite; silence is efficient.
* **Dual-Layer Command Injection:**
    * **DOM Level:** Click, Type, Read.
    * **Browser Level:** Refresh, Back, Forward, Find (Text Search & Scroll).
* **Universal Compatibility:** Works on any target URL. If it renders HTML, it can be controlled.

## 📂 File Structure

* `manifest.json`: The entry point. Permissions: `scripting`, `tabs`, `storage`.
* `background.js`: The central nervous system. Routes messages between the isolated worlds of the Agent and the Target. State is persisted in `chrome.storage.session` to survive Service Worker suspensions, protected by a mutex.
* `content.js`: The enforcer. Injects logic into the page, executes commands, and reports state.
* `heuristics.js`: The brain. Analyzes the DOM to generate a semantic map of the Target.
* `popup.html` / `popup.js`: The interface for assigning roles.

## 🔧 Installation (Sideload)

Since this tool effectively turns your browser into a botnet node, it is not on the Web Store.

1.  Clone or download this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (top right toggle).
4.  Click **Load unpacked**.
5.  Select the `AgentAnything` directory.

## 🕹️ Usage Protocol

### Phase 1: The Victim (Target)
1.  Navigate to the website you wish to control (e.g., a documentation site, a search engine, a competitor's dashboard).
2.  Click the **AgentAnything** extension icon.
3.  Select **MAKE TARGET**.
    * *Status:* The tab is now listening. It will snapshot its DOM and wait for orders.

### Phase 2: The Master (Agent)
1.  Open your LLM of choice (ChatGPT, Claude, Gemini, DeepSeek) in a new tab.
2.  Click the **AgentAnything** extension icon.
3.  Select **MAKE AGENT**.
    * *Status:* A System Prompt is automatically copied to your clipboard. An "Observation Deck" overlay appears on the screen.
4.  Paste the System Prompt into the AI chat and press Enter.

### Phase 3: The Loop
1.  Issue a natural language command to the AI (e.g., *"Search for 'glitch art' and open the first result"*).
2.  The AI outputs a JSON command block.
3.  **AgentAnything** parses the block and transmits it to the Target.
4.  The Target executes the action and returns a Diff of the page changes.
5.  The new state is injected into the Agent's Observation Deck.
6.  Repeat until the task is complete or the browser crashes under the weight of its own existence.

## 🧪 Development

### Running Tests
To verify the core logic (state persistence, mutexes, deadlock recovery), run:

```bash
node tests/background_test.js
```

## ⚠️ Known Limitations & quirks

* **Hallucinations:** If the AI outputs invalid JSON, the extension will log an error to the console. You must manually chastise the AI to correct its syntax.
* **iframe / CORS:** Deeply nested cross-origin iframes are difficult to penetrate without compromising browser security settings. The Heuristic Engine attempts to pierce Shadow DOMs but respects cross-origin boundaries.
* **Deadlocks:** If the Agent hangs for more than 3 minutes, the extension will auto-unlock to prevent indefinite freezing.

## 📜 License

MIT. Do what you want. I am not responsible for what you break.
