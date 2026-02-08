# AgentAnything V2

> "Turn one tab into the Agent, another tab into its tool."

**AgentAnything** is a Chrome Extension that transforms a standard browsing session into a master-slave architecture, allowing an AI (running in the **Agent** tab) to programmatically control, read, and manipulate any other website (the **Target** tab).

**Version 2.0 Feature Set:**
*   **Agent Bridge**: Robustly injects prompts into ChatGPT, Claude, and Gemini using advanced framework bypass techniques (React/ProseMirror support).
*   **Semantic Parser**: Distills complex web pages into a compressed XML/Markdown schema, saving tokens while preserving context.
*   **Secure Execution**: Uses the Chrome Debugger API to execute clicks and keystrokes in background tabs without stealing focus.
*   **Privacy First**: Automatically redacts PII (emails, phone numbers, credit cards) before sending data to the AI.
*   **Multi-Tab Control**: Can manage multiple target tabs simultaneously.

## 📂 File Structure

* `manifest.json`: Manifest V3 configuration.
* `background.js`: Store-First Service Worker. Manages state, queues commands, and enforces privacy policies.
* `content/`:
    * `agent_bridge.js`: Injects prompts and parses AI responses.
    * `target_adapter.js`: Scrapes DOM, redacts PII, and detects user interruptions.
    * `agent_dashboard.js`: Visual status panel.
* `welcome.html`: Privacy onboarding flow.
* `options.html`: Configuration settings.

## 🔧 Installation (Sideload)

1.  Clone this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (top right toggle).
4.  Click **Load unpacked**.
5.  Select the `AgentAnything` directory.
6.  **Important**: You must complete the Privacy Onboarding that opens automatically to enable the extension.

## 🕹️ Usage

1.  **Assign Agent**: Open your AI (ChatGPT/Claude), click extension -> **MAKE AGENT**.
2.  **Assign Target**: Open a website, click extension -> **MAKE TARGET**.
3.  **Command**: In the Agent tab, type a command (e.g., "Find the cheapest flight to Tokyo").
4.  **Observe**: The Agent will autonomously browse the target tab.

## ⚠️ Privacy Warning

This tool transmits page content from your "Target" tabs to the "Agent" tab (your active AI provider session). While PII is redacted locally, you are responsible for the data you choose to share with the AI.

## 🧪 Development

Run tests:
```bash
node tests/background_test.js
```

## 📜 License

MIT.
