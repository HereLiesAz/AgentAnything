(function() {
// Agent Dashboard - Visual Feedback Panel (V2.1 - Non-Obtrusive)
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
        // Ensure host itself doesn't block clicks outside the panel
        host.style.pointerEvents = 'none';
        document.body.appendChild(host);

        const shadow = host.attachShadow({mode: 'closed'});
        host._shadowRoot = shadow;

        const style = document.createElement('style');
        style.textContent = `
            .panel {
                background: rgba(30, 30, 30, 0.9); /* Slightly transparent */
                color: #fff;
                font-family: monospace;
                padding: 10px;
                border-radius: 8px;
                border: 1px solid #444;
                width: 220px;
                font-size: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                pointer-events: auto; /* Re-enable clicks for the panel */
                transition: height 0.3s ease;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #444;
                padding-bottom: 5px;
                margin-bottom: 5px;
            }
            .title { font-weight: bold; color: #aaa; }
            .btn-min {
                background: transparent;
                border: 1px solid #555;
                color: #fff;
                cursor: pointer;
                border-radius: 4px;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                line-height: 1;
            }
            .btn-min:hover { background: #444; }

            .status { margin-bottom: 5px; display: flex; align-items: center; }
            .dot {
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #00ff00;
                margin-right: 8px;
            }
            .queue { color: #888; margin-bottom: 3px; }
            .last-action {
                color: #aaa;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 200px;
            }

            .blocker {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: transparent; /* FIX: Fully transparent to avoid obstruction */
                z-index: 2147483646; /* Just below overlay */
                pointer-events: auto; /* Capture clicks */
                display: none;
                cursor: not-allowed;
            }
        `;
        shadow.appendChild(style);

        // Blocker (Full Screen, Transparent)
        const blocker = document.createElement('div');
        blocker.className = 'blocker';
        blocker.title = "Agent is working... (Interactions Blocked)";
        shadow.appendChild(blocker);

        // Panel
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="header">
                <span class="title">Agent Bridge</span>
                <button class="btn-min" id="minimize-btn" title="Toggle Dashboard">-</button>
            </div>
            <div id="panel-content">
                <div class="status"><span class="dot"></span>Connected</div>
                <div class="queue">Queue: 0</div>
                <div class="last-action">Waiting...</div>
            </div>
        `;
        shadow.appendChild(panel);

        // Minimize Logic
        const btn = panel.querySelector('#minimize-btn');
        const content = panel.querySelector('#panel-content');

        btn.onclick = (e) => {
            e.stopPropagation(); // Prevent propagation
            if (content.style.display === 'none') {
                content.style.display = 'block';
                btn.innerText = '-';
            } else {
                content.style.display = 'none';
                btn.innerText = '+';
            }
        };
    }
    return host._shadowRoot;
}

// Interaction Blocking
function blockInteractions(enable) {
    // We use the capture phase to stop immediate propagation
    const events = ['click', 'mousedown', 'mouseup', 'keydown', 'keypress', 'keyup', 'submit', 'focus'];
    const handler = (e) => {
        // Allow interaction with our dashboard
        if (e.target.closest && e.target.closest('#agent-dashboard')) return;

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
    const dot = root.querySelector('.dot');

    if (state.status) {
        // Update Status Text
        // We reconstruct innerHTML to keep the dot
        statusEl.innerHTML = '';
        statusEl.appendChild(dot);
        statusEl.append(document.createTextNode(state.status));

        let shouldBlock = false;

        // Color Logic
        if (state.color) {
            if (state.color === 'green') dot.style.background = '#00ff00';
            else if (state.color === 'yellow') dot.style.background = '#ffff00';
            else dot.style.background = '#ff0000';
        }

        // Blocking Logic
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

        // Apply Blocking
        if (shouldBlock !== isBlocked) {
            isBlocked = shouldBlock;
            blockInteractions(isBlocked);
        }
    }

    if (state.queueLength !== undefined) queueEl.innerText = `Queue: ${state.queueLength}`;
    if (state.lastAction) actionEl.innerText = state.lastAction;
}

// Hook into Agent Bridge
if (chrome.runtime?.id) {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "DASHBOARD_UPDATE") {
            updateDashboard(msg.payload);
        }
    });
}

})();
