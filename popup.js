document.addEventListener('DOMContentLoaded', async () => {
    const viewSetup = document.getElementById('view-setup');
    const viewActive = document.getElementById('view-active');
    const txtInput = document.getElementById('remote-input');
    
    // Buttons
    const btnAgent = document.getElementById('btn-agent');
    const btnTarget = document.getElementById('btn-target');
    const btnInject = document.getElementById('btn-inject');
    const btnKill = document.getElementById('btn-kill');
    const roleIndicator = document.getElementById('role-indicator');

    // 1. CHECK STATE
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds']);
    const hasAgent = !!store.agentTabId;
    const hasTarget = store.targetTabIds && store.targetTabIds.length > 0;
    
    // STRICT GATEKEEPING
    if (hasAgent && hasTarget) {
        viewSetup.style.display = 'none';
        viewActive.style.display = 'block';
        roleIndicator.innerText = `[${store.targetTabIds.length} Targets]`;
    } else {
        viewSetup.style.display = 'block';
        viewActive.style.display = 'none';
        
        // Update Setup Buttons
        if (hasAgent) {
            btnAgent.innerText = "AGENT ASSIGNED ✅";
            btnAgent.classList.add('btn-done');
            btnAgent.disabled = true;
            btnTarget.classList.add('btn-pulse');
        }
        
        if (hasTarget) {
            btnTarget.innerText = `TARGETS ASSIGNED (${store.targetTabIds.length}) ✅`;
            btnTarget.classList.add('btn-done');
        }
    }

    // 2. ASSIGN AGENT
    btnAgent.onclick = async () => {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "AGENT", tabId: tabs[0].id });
        window.close();
    };

    // 3. ASSIGN TARGET
    btnTarget.onclick = async () => {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "TARGET", tabId: tabs[0].id });
        window.close();
    };

    // 4. REMOTE INJECT
    btnInject.onclick = async () => {
        const text = txtInput.value.trim();
        if (!text || !store.agentTabId) return;
        
        btnInject.disabled = true;
        btnInject.innerText = "SENDING...";

        chrome.tabs.sendMessage(store.agentTabId, { 
            action: "REMOTE_INJECT", 
            payload: text 
        }).catch(err => {
             console.error("Injection Failed", err);
             btnInject.innerText = "FAILED (Check Console)";
        });

        setTimeout(() => { 
            btnInject.disabled = false; 
            btnInject.innerText = "SEND COMMAND"; 
            txtInput.value = "";
        }, 1000);
    };

    // 5. DISENGAGE
    const handleDisengage = () => {
        chrome.runtime.sendMessage({ action: "DISENGAGE_ALL" });
        setTimeout(() => window.close(), 500);
    };

    btnKill.onclick = handleDisengage;
    document.getElementById('btn-reset-setup').onclick = handleDisengage;
});
