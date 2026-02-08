document.addEventListener('DOMContentLoaded', async () => {
    const viewSetup = document.getElementById('view-setup');
    const viewActive = document.getElementById('view-active');
    const txtInput = document.getElementById('remote-input');
    
    // Check State
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds']);
    const hasAgent = !!store.agentTabId;
    
    if (hasAgent) {
        viewSetup.style.display = 'none';
        viewActive.style.display = 'block';
    } else {
        viewSetup.style.display = 'block';
        viewActive.style.display = 'none';
    }

    // Assign Roles
    document.getElementById('btn-agent').onclick = async () => {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "AGENT", tabId: tabs[0].id });
        window.close();
    };

    document.getElementById('btn-target').onclick = async () => {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "TARGET", tabId: tabs[0].id });
        window.close();
    };

    // Remote Inject
    document.getElementById('btn-inject').onclick = async () => {
        const text = txtInput.value.trim();
        if (!text || !store.agentTabId) return;
        
        const btn = document.getElementById('btn-inject');
        btn.disabled = true;
        btn.innerText = "Sending...";

        chrome.tabs.sendMessage(store.agentTabId, { 
            action: "REMOTE_INJECT", 
            payload: text 
        }, () => {
            btn.innerText = "Sent!";
            txtInput.value = "";
            setTimeout(() => { 
                btn.disabled = false; 
                btn.innerText = "SEND COMMAND"; 
            }, 1500);
        });
    };

    // Disengage
    document.getElementById('btn-kill').onclick = () => {
        chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
        location.reload();
    };
});
