document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const statusDiv = document.getElementById('status');

  document.getElementById('btn-agent').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "AGENT", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "INIT_AGENT" });
    statusDiv.textContent = "This tab is now the Agent.";
  });

  document.getElementById('btn-target').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "ASSIGN_ROLE", role: "TARGET", tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "INIT_TARGET", tabId: tab.id });
    statusDiv.textContent = "This tab is now a Target.";
  });
});
