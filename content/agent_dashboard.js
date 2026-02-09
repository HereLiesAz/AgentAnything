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
            .blocker {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.05);
                z-index: 2147483646; /* Just below overlay */
                pointer-events: none; /* Allows scrolling */
                display: none;
            }
        `;
        shadow.appendChild(style);

        const blocker = document.createElement('div');
        blocker.className = 'blocker';
        shadow.appendChild(blocker);

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

// Interaction Blocking
function blockInteractions(enable) {
    const events = ['click', 'mousedown', 'mouseup', 'keydown', 'keypress', 'keyup', 'submit', 'focus'];
    const handler = (e) => {
        e.stopPropagation();
        e.preventDefault();
    };

    if (enable) {
        events.forEach(ev => window.addEventListener(ev, handler, true));
    } else {
        events.forEach(ev => window.removeEventListener(ev, handler, true));
    }
}

let isBlocked = false;

function updateDashboard(state) {
    const root = ensureDashboard();
    const statusEl = root.querySelector('.status');
    const queueEl = root.querySelector('.queue');
    const actionEl = root.querySelector('.last-action');
    const blocker = root.querySelector('.blocker');

    if (state.status) {
        statusEl.innerHTML = `<span class="dot"></span>Bridge: ${state.status}`;
        const dot = root.querySelector('.dot');

        let shouldBlock = false;

        // Use explicitly provided color
        if (state.color) {
            if (state.color === 'green') dot.style.background = '#00ff00';
            else if (state.color === 'yellow') dot.style.background = '#ffff00';
            else dot.style.background = '#ff0000';
        }

        // Logic for blocking: If Linked or Waiting, block.
        // Status might be "Working" (Green), "Linked (Waiting)" (Yellow), "Waiting for..." (Yellow)
        if (state.status.includes('Linked') || state.status.includes('Waiting') || state.status === 'Working') {
            blocker.style.display = 'block';
            shouldBlock = true;
        } else {
            blocker.style.display = 'none';
            shouldBlock = false;
        }

        if (state.status === 'Idle') {
             blocker.style.display = 'none';
             shouldBlock = false;
        }

        if (shouldBlock !== isBlocked) {
            isBlocked = shouldBlock;
            blockInteractions(isBlocked);
        }
    }

    if (state.queueLength !== undefined) queueEl.innerText = `Queue: ${state.queueLength}`;
    if (state.lastAction) actionEl.innerText = state.lastAction;
}

// Hook into Agent Bridge
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "DASHBOARD_UPDATE") {
        updateDashboard(msg.payload);
    }
});
