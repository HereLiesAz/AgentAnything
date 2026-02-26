// content/agent_dashboard.js

(function() {

  if (window.__AA_DASHBOARD__) return;
  window.__AA_DASHBOARD__ = true;

  const dashboard = document.createElement('div');
  dashboard.id = 'aa-dashboard-root';

  Object.assign(dashboard.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '280px',
    height: '160px',
    background: 'rgba(20,20,20,0.95)',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '8px',
    padding: '10px',
    zIndex: 999999999,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    overflow: 'hidden'
  });

  dashboard.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px;">AgentAnything</div>
    <div id="aa-status">Status: Idle</div>
    <div id="aa-network">Network: Off</div>
  `;

  document.documentElement.appendChild(dashboard);

  // Safe touch listener (PASSIVE)
  dashboard.addEventListener(
    "touchstart",
    () => {},
    { passive: true }
  );

  // Example state listener
  chrome.runtime.onMessage.addListener((msg) => {

    if (msg.type === "AA_NETWORK_REQUEST") {
      const el = document.getElementById("aa-network");
      if (el) el.textContent = "Network: Active";
    }

  });

})();
