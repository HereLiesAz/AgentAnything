document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  document.getElementById('btn-agent').onclick = () => {
    chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "AGENT", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "INIT_AGENT" });
    window.close();
  };

  document.getElementById('btn-target').onclick = () => {
    chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "TARGET", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "INIT_TARGET", tabId: tab.id });
    window.close();
  };

  document.getElementById('btn-options').onclick = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  };
});
