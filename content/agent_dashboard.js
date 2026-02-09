// Agent Dashboard - Visual Feedback Panel
console.log("[AgentAnything] Agent Dashboard Loaded");

function ensureDashboard() {
    let host = document.getElementById('agent-dashboard');
    if (!host) {
        host = document.createElement('div');
        host.id = 'agent-dashboard';
        host.style.position = 'fixed';
        host.style.bottom = '10px';
        host.style.right = '10px';
        host.style.zIndex = '999999';
        document.body.appendChild(host);

        const shadow = host.attachShadow({mode: 'closed'});
        host._shadowRoot = shadow;

        const style = document.createElement('style');
        style.textContent = `
            .panel {
                background: #1e1e1e;
                color: #fff;
                font-family: monospace;
                padding: 10px;
                border-radius: 8px;
                border: 1px solid #333;
                width: 200px;
                font-size: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            }
            .status { margin-bottom: 5px; }
            .dot {
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #00ff00;
                margin-right: 5px;
            }
            .queue { color: #888; }
        `;
        shadow.appendChild(style);

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="status"><span class="dot"></span>Connected</div>
            <div class="queue">Queue: 0</div>
            <div class="last-action">Waiting...</div>
        `;
        shadow.appendChild(panel);
    }
    return host._shadowRoot;
}

function updateDashboard(state) {
    const root = ensureDashboard();
    const queueEl = root.querySelector('.queue');
    const actionEl = root.querySelector('.last-action');

    if (state.queueLength !== undefined) queueEl.innerText = `Queue: ${state.queueLength}`;
    if (state.lastAction) actionEl.innerText = state.lastAction;
}

// Hook into Agent Bridge
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "DASHBOARD_UPDATE") {
        updateDashboard(msg.payload);
    }
});
