(function() {
// Target Adapter - Semantic Parsing (V2.0)
console.log("[AgentAnything] Target Adapter V2 Loaded");

// --- 1. State ---
let interactables = {};
let nextId = 1;
let lastSnapshot = "";
let targetDebounceTimer = null;
let apiCalls = []; // Captured API calls

// --- 2. Overlay (Phase 2) ---

let overlayRef = null;

function showGreenOutline(elementId) {
    const el = interactables[elementId];
    if (!el) return;

    // Inject Shadow DOM overlay
    let host = document.getElementById('agent-overlay');

    if (!host) {
        host = document.createElement('div');
        host.id = 'agent-overlay';
        // Ensure it covers viewport and is on top
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '100vw';
        host.style.height = '100vh';
        host.style.zIndex = '2147483647';
        host.style.pointerEvents = 'none'; // Crucial!
        document.body.appendChild(host);
        overlayRef = host.attachShadow({mode: 'closed'});
    }

    // Draw green box at element coordinates
    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.position = 'absolute'; // within fixed overlay
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.border = '2px solid #00ff00';
    box.style.zIndex = '999999';
    box.style.pointerEvents = 'none';

    // Label
    const label = document.createElement('span');
    label.innerText = `ID: ${elementId}`;
    label.style.background = '#00ff00';
    label.style.color = '#000';
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '0';
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    label.style.padding = '2px 4px';

    box.appendChild(label);
    overlayRef.appendChild(box);

    // Remove after 2s
    setTimeout(() => {
        if (box && box.parentNode) box.remove();
    }, 2000);
}


// --- 3. DOM Parsing (Phase 2) ---

function redactPII(text) {
    if (!text) return "";
    text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
    // Simple US Phone
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    // Simple CC (16 digits)
    text = text.replace(/\b(?:\d{4}[- ]?){3}\d{4}\b/g, '[CC]');
    return text;
}

function parseDOM() {
    interactables = {};
    nextId = 1; // Reset IDs for fresh snapshot

    let output = [];
    let elementIds = [];

    // Use TreeWalker (V2 Requirement)
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode: (node) => {
                const tag = node.tagName.toLowerCase();
                // "ignoring <script>, <style>, and hidden elements"
                if (['script', 'style', 'noscript', 'meta', 'link', 'svg', 'path'].includes(tag)) return NodeFilter.FILTER_REJECT;

                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    while(walker.nextNode()) {
        const el = walker.currentNode;
        const tag = el.tagName.toLowerCase();

        const isInteractive = (
            tag === 'a' ||
            tag === 'button' ||
            tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('contenteditable') === 'true' ||
            el.onclick
        );

        if (isInteractive) {
            const id = nextId++;
            interactables[id] = el;
            elementIds.push(id);
            el.dataset.agentId = id;

            let xml = `<${tag} id="${id}"`;

            if (el.value) xml += ` value="${redactPII(el.value)}"`;
            if (el.placeholder) xml += ` placeholder="${redactPII(el.placeholder)}"`;

            let labelText = el.getAttribute('aria-label') || el.getAttribute('name');
            if (!labelText && el.id) {
                const labelEl = document.querySelector(`label[for="${el.id}"]`);
                if (labelEl) labelText = labelEl.innerText;
            }
            if (labelText) xml += ` label="${redactPII(labelText)}"`;

            if (tag === 'a' && el.href) {
                try {
                    const url = new URL(el.href);
                    xml += ` href="${url.origin}${url.pathname}[REDACTED_QUERY]"`;
                } catch(e) {
                     xml += ` href="[INVALID_URL]"`;
                }
            }

            let innerText = "";
            if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                innerText = el.innerText.trim();
                innerText = redactPII(innerText).substring(0, 50); // Truncate
            }

            xml += `>`;

            if (innerText) {
                xml += `${innerText}`;
            }

            xml += `</${tag}>`;

            output.push(xml);
        }
    }

    return { snapshot: output.join("\n"), elementIds: elementIds };
}


// --- 4. Network Monitoring (V2.4) ---

function injectNetworkHook() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/network_hook.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'AA_NETWORK_HOOK') return;
        const call = event.data.payload;
        // Buffer latest 5 calls
        apiCalls.unshift(call);
        if (apiCalls.length > 5) apiCalls.pop();
        checkChanges(); // Trigger update immediately on API call
    });
}


// --- 5. Diffing & Updates (Phase 2) ---

function checkChanges() {
    const result = parseDOM();
    let currentSnapshot = result.snapshot;

    // Append API Calls (V2.4)
    if (apiCalls.length > 0) {
        currentSnapshot += "\n\n<api_activity>\n";
        apiCalls.forEach(api => {
            currentSnapshot += `  <call method="${api.method}" url="${api.url}">\n    ${redactPII(api.body || '')}\n  </call>\n`;
        });
        currentSnapshot += "</api_activity>";
    }

    if (currentSnapshot !== lastSnapshot) {
        lastSnapshot = currentSnapshot;

        const payload = `[Target Update]\nURL: ${window.location.href}\nInteractive Elements:\n${currentSnapshot}`;

        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({
                action: "TARGET_UPDATE",
                payload: payload,
                elementIds: result.elementIds
            }).catch(() => {});
        }
    }
}

// Debounce updates
const observer = new MutationObserver(() => {
    if (targetDebounceTimer) clearTimeout(targetDebounceTimer);
    targetDebounceTimer = setTimeout(checkChanges, 500); // 500ms debounce
});


// --- 6. User Interrupt Detection (V2.2) ---

function handleUserInteraction() {
    if (this._interruptTimer) return;
    this._interruptTimer = setTimeout(() => { this._interruptTimer = null; }, 1000);
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "USER_INTERRUPT" }).catch(() => {});
    }
}

window.addEventListener('mousedown', handleUserInteraction, true);
window.addEventListener('keydown', handleUserInteraction, true);


// --- 7. Message Listener ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "INIT_TARGET") {
        console.log("Target Initialized");
        injectNetworkHook(); // Inject hook
        checkChanges();
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }

    if (msg.action === "GET_COORDINATES") {
        const id = parseInt(msg.id);
        const el = interactables[id];

        if (el) {
            const rect = el.getBoundingClientRect();
            showGreenOutline(id);
            sendResponse({
                x: rect.left + (rect.width / 2),
                y: rect.top + (rect.height / 2),
                found: true
            });
        } else {
            sendResponse({ found: false });
        }
        return true;
    }
});
})();
