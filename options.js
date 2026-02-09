// Options Logic
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);

function saveOptions() {
    const redactPII = document.getElementById('redactPII').checked;
    const debugMode = document.getElementById('debugMode').checked;
    
    chrome.storage.sync.set({
        redactPII: redactPII,
        debugMode: debugMode
    }, () => {
        const status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(() => { status.textContent = ''; }, 2000);
    });
}

function restoreOptions() {
    chrome.storage.sync.get({
        redactPII: true, // Default true for safety
        debugMode: false
    }, (items) => {
        document.getElementById('redactPII').checked = items.redactPII;
        document.getElementById('debugMode').checked = items.debugMode;
    });
}
