// popup.js V2.1 — adds save-as-tool flow after TARGET assignment
document.addEventListener('DOMContentLoaded', async () => {
    const viewSetup    = document.getElementById('view-setup');
    const viewActive   = document.getElementById('view-active');
    const viewSaveTool = document.getElementById('view-save-tool');
    const txtInput     = document.getElementById('remote-input');

    const btnAgent        = document.getElementById('btn-agent');
    const btnTarget       = document.getElementById('btn-target');
    const btnInject       = document.getElementById('btn-inject');
    const btnKill         = document.getElementById('btn-kill');
    const btnOptions      = document.getElementById('btn-options');
    const btnOptionsActive = document.getElementById('btn-options-active');
    const btnSaveTool     = document.getElementById('btn-save-tool');
    const btnSkipTool     = document.getElementById('btn-skip-tool');

    // State is in chrome.storage.local. Keys: agentTabId, targetTabs (array of {tabId,url})
    const store = await chrome.storage.local.get(['agentTabId', 'targetTabs']);
    const hasAgent  = !!store.agentTabId;
    const targetTabs = Array.isArray(store.targetTabs) ? store.targetTabs : [];
    const hasTarget = targetTabs.length > 0;

    if (hasAgent && hasTarget) {
        viewSetup.style.display    = 'none';
        viewActive.style.display   = 'block';
    } else {
        viewSetup.style.display = 'block';
        if (hasAgent) {
            btnAgent.innerText = "AGENT ASSIGNED ✅";
            btnAgent.classList.add('btn-done');
            btnAgent.disabled = true;
            btnTarget.classList.add('btn-pulse');
        }
        if (hasTarget) {
            btnTarget.innerText = `TARGETS ASSIGNED (${targetTabs.length}) ✅`;
            btnTarget.classList.add('btn-done');
        }
    }

    // ── ASSIGN AGENT ──────────────────────────────────────────────────────────
    btnAgent.onclick = async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const task = document.getElementById('task-input').value.trim();
        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "AGENT", tabId: tabs[0].id, task });
        window.close();
    };

    // ── ASSIGN TARGET — then offer to save as tool ────────────────────────────
    // We capture the tab info before sending the assignment message so we can
    // pre-fill the tool name field with the page title.
    let pendingToolUrl   = '';

    btnTarget.onclick = async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab  = tabs[0];
        pendingToolUrl = tab.url || '';

        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "TARGET", tabId: tab.id });

        // Transition to save-as-tool prompt instead of closing immediately
        viewSetup.style.display    = 'none';
        viewSaveTool.style.display = 'block';

        // Pre-fill URL preview and smart default name
        const urlPreview    = document.getElementById('tool-url-preview');
        const toolNameInput = document.getElementById('tool-name-input');
        try {
            const hostname = new URL(pendingToolUrl).hostname.replace(/^www\./, '');
            urlPreview.textContent = hostname;
            // Strip common title suffixes like "— Google" or "| Gmail"
            let defaultName = (tab.title || hostname).replace(/\s*[-|–|—].*$/, '').trim();
            toolNameInput.value = defaultName;
            toolNameInput.select();
        } catch(e) {
            urlPreview.textContent = pendingToolUrl;
        }

        toolNameInput.focus();
    };

    // Save tool and close
    btnSaveTool.onclick = () => {
        const name = document.getElementById('tool-name-input').value.trim();
        if (name && pendingToolUrl) {
            chrome.runtime.sendMessage({ action: "SAVE_TOOL", name, url: pendingToolUrl });
        }
        window.close();
    };

    // Skip saving tool and close
    btnSkipTool.onclick = () => window.close();

    // Allow Enter key to confirm save
    document.getElementById('tool-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnSaveTool.click();
        if (e.key === 'Escape') btnSkipTool.click();
    });

    // ── REMOTE INJECT ─────────────────────────────────────────────────────────
    btnInject.onclick = async () => {
        const text = txtInput.value.trim();
        if (!text) return;

        // Re-read live state so we don't use a stale agentTabId from the closure
        const current = await chrome.storage.local.get(['agentTabId']);
        if (!current.agentTabId) {
            console.warn("[Popup] No agent tab assigned.");
            return;
        }

        btnInject.disabled  = true;
        btnInject.innerText = "SENDING...";
        chrome.runtime.sendMessage({ action: "REMOTE_INJECT", payload: text });
        setTimeout(() => {
            btnInject.disabled  = false;
            btnInject.innerText = "SEND COMMAND";
            txtInput.value = "";
        }, 1000);
    };

    // ── DISENGAGE ─────────────────────────────────────────────────────────────
    const handleDisengage = () => {
        chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
        setTimeout(() => location.reload(), 500);
    };

    // ── OPTIONS ───────────────────────────────────────────────────────────────
    const openOptions = () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    };

    if (btnKill)          btnKill.onclick = handleDisengage;
    if (btnOptions)       btnOptions.onclick = openOptions;
    if (btnOptionsActive) btnOptionsActive.onclick = openOptions;

    const resetBtn = document.getElementById('btn-reset-setup');
    if (resetBtn) {
        resetBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
            setTimeout(() => location.reload(), 500);
        };
    }
});
