(function() {
// Agent Dashboard - Visual Feedback Panel (V2.2)
// FIXES:
//   - blockInteractions handler leak (removeEventListener requires same reference)
//   - Agent tab no longer has its interactions blocked (only target tabs are blocked)
//   - Blocker div removed in favor of JS-only blocking (avoids z-index cursor issues)
console.log("[AgentAnything] Agent Dashboard V2.2 Loaded");

function ensureDashboard() {
    let host = document.getElementById('agent-dashboard');
    if (!host) {
        host = document.createElement('div');
        host.id = 'agent-dashboard';
        host.style.position = 'fixed';
        host.style.bottom = '10px';
        host.style.right = '10px';
        host.style.zIndex = '2147483646';
        host.style.pointerEvents = 'none';
        document.body.appendChild(host);

        const shadow = host.attachShadow({mode: 'closed'});
        host._shadowRoot = shadow;

        const style = document.createElement('style');
        style.textContent = `
            .panel {
                background: rgba(30, 30, 30, 0.92);
                color: #fff;
                font-family: monospace;
                padding: 10px;
                border-radius: 8px;
                border: 1px solid #444;
                width: 220px;
                font-size: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                pointer-events: auto;
                transition: height 0.3s ease;
                cursor: default;
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
                flex-shrink: 0;
            }
            .queue { color: #888; margin-bottom: 3px; }
            .last-action {
                color: #aaa;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 200px;
            }
            .blocked-banner {
                background: rgba(191, 97, 106, 0.2);
                border: 1px solid #bf616a;
                border-radius: 4px;
                color: #ff9a9a;
                font-size: 10px;
                padding: 4px 6px;
                margin-top: 5px;
                display: none;
            }
        `;
        shadow.appendChild(style);

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="header">
                <span class="title">Agent Bridge</span>
                <button class="btn-min" id="minimize-btn" title="Toggle Dashboard">-</button>
            </div>
            <div id="panel-content">
                <div class="status"><span class="dot"></span><span class="status-text">Connected</span></div>
                <div class="queue">Queue: 0</div>
                <div class="last-action">Waiting...</div>
                <div class="blocked-banner" id="blocked-banner">⛔ Agent working — interactions paused</div>
            </div>
        `;
        shadow.appendChild(panel);

        const btn = panel.querySelector('#minimize-btn');
        const content = panel.querySelector('#panel-content');

        btn.onclick = (e) => {
            e.stopPropagation();
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

// FIX: Store the handler reference so removeEventListener can find the same function object.
// Previous code created a new closure on each call, so removeEventListener never matched.
let blockHandler = null;
let isBlocked = false;

function blockInteractions(enable) {
    const events = ['click', 'mousedown', 'mouseup', 'keydown', 'keypress', 'keyup', 'submit'];
    
    if (enable && !blockHandler) {
        blockHandler = (e) => {
            // Allow interaction with our dashboard regardless
            if (e.composedPath && e.composedPath().some(el => el.id === 'agent-dashboard')) return;
            e.stopImmediatePropagation();
            e.preventDefault();
        };
        events.forEach(ev => window.addEventListener(ev, blockHandler, true));
    } else if (!enable && blockHandler) {
        events.forEach(ev => window.removeEventListener(ev, blockHandler, true));
        blockHandler = null;
    }
}

function updateDashboard(state) {
    const root = ensureDashboard();
    const statusEl = root.querySelector('.status');
    const statusText = root.querySelector('.status-text');
    const queueEl = root.querySelector('.queue');
    const actionEl = root.querySelector('.last-action');
    const dot = root.querySelector('.dot');
    const blockedBanner = root.querySelector('#blocked-banner');

    if (state.status && statusText) {
        statusText.textContent = state.status;

        if (state.color) {
            if (state.color === 'green') dot.style.background = '#00ff00';
            else if (state.color === 'yellow') dot.style.background = '#ffff00';
            else dot.style.background = '#ff0000';
        }

        // FIX: Only block interactions on TARGET tabs, never on the AGENT tab.
        // The agent tab needs to remain fully interactive so the user can read AI responses.
        let shouldBlock = false;

        if (!state.isAgentTab && !state.allowInput) {
            if (state.status === 'Working') {
                shouldBlock = true;
            }
        }

        // Update blocked banner
        if (blockedBanner) {
            blockedBanner.style.display = shouldBlock ? 'block' : 'none';
        }

        if (shouldBlock !== isBlocked) {
            isBlocked = shouldBlock;
            blockInteractions(isBlocked);
        }
    }

    if (state.queueLength !== undefined && queueEl) {
        queueEl.innerText = `Queue: ${state.queueLength}`;
    }
    if (state.lastAction && actionEl) {
        actionEl.innerText = state.lastAction;
    }
}

if (chrome.runtime?.id) {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "DASHBOARD_UPDATE") {
            updateDashboard(msg.payload);
        }
    });
}

})();
