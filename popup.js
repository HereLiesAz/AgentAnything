document.addEventListener('DOMContentLoaded', async () => {
    const viewSetup = document.getElementById('view-setup');
    const viewActive = document.getElementById('view-active');
    const txtInput = document.getElementById('remote-input');
    
    // Buttons
    const btnAgent = document.getElementById('btn-agent');
    const btnTarget = document.getElementById('btn-target');
    const btnInject = document.getElementById('btn-inject');
    const btnKill = document.getElementById('btn-kill');
    const btnOptions = document.getElementById('btn-options');
    const btnOptionsActive = document.getElementById('btn-options-active');

    // 1. CHECK STATE
    const store = await chrome.storage.session.get(['agentTabId', 'targetTabIds']);
    const hasAgent = !!store.agentTabId;
    const hasTarget = store.targetTabIds && store.targetTabIds.length > 0;
    
    if (hasAgent && hasTarget) {
        viewSetup.style.display = 'none';
        viewActive.style.display = 'block';
    } else {
        viewSetup.style.display = 'block';
        viewActive.style.display = 'none';
        
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

        chrome.runtime.sendMessage({ 
            action: "REMOTE_INJECT", 
            payload: text 
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
        setTimeout(() => location.reload(), 500);
    };

    // 6. OPTIONS LINK
    const openOptions = () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    };

    btnKill.onclick = handleDisengage;
    document.getElementById('btn-reset-setup').onclick = handleDisengage;
    
    if(btnOptions) btnOptions.onclick = openOptions;
    if(btnOptionsActive) btnOptionsActive.onclick = openOptions;
});
