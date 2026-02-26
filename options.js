// options.js V2.1 — adds maxTabs setting and saved tools management

document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();
    renderTools();
});

document.getElementById('save').addEventListener('click', saveOptions);

function saveOptions() {
    const redactPII = document.getElementById('redactPII').checked;
    const debugMode = document.getElementById('debugMode').checked;
    const maxTabs   = Math.min(10, Math.max(1, parseInt(document.getElementById('maxTabs').value) || 3));

    chrome.storage.sync.set({ redactPII, debugMode, maxTabs }, () => {
        const status = document.getElementById('status');
        status.textContent = '✅ Settings saved.';
        setTimeout(() => { status.textContent = ''; }, 2500);
    });
}

function restoreOptions() {
    chrome.storage.sync.get({ redactPII: true, debugMode: false, maxTabs: 3 }, (items) => {
        document.getElementById('redactPII').checked = items.redactPII;
        document.getElementById('debugMode').checked = items.debugMode;
        document.getElementById('maxTabs').value     = items.maxTabs;
    });
}

// ── Saved Tools ───────────────────────────────────────────────────────────────

function renderTools() {
    chrome.storage.sync.get({ savedTools: [] }, ({ savedTools }) => {
        const list = document.getElementById('tool-list');
        list.innerHTML = '';

        if (!savedTools || savedTools.length === 0) {
            list.innerHTML = '<div class="empty-hint">No tools saved yet. Assign a target tab and choose "Save as Tool" in the popup.</div>';
            return;
        }

        savedTools.forEach(tool => {
            const row = document.createElement('div');
            row.className = 'tool-row';
            row.innerHTML = `
                <span class="tool-name">${escapeHtml(tool.name)}</span>
                <span class="tool-url" title="${escapeHtml(tool.url)}">${escapeHtml(tool.url)}</span>
                <button class="btn-del" data-id="${escapeHtml(tool.id)}">✕ Remove</button>
            `;
            row.querySelector('.btn-del').addEventListener('click', () => deleteTool(tool.id));
            list.appendChild(row);
        });
    });
}

function deleteTool(id) {
    chrome.runtime.sendMessage({ action: "DELETE_TOOL", id }, () => {
        renderTools();
    });
}

// Re-render if tools change while options page is open
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.savedTools) {
        renderTools();
    }
});

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
