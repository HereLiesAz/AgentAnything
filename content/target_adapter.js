// Target Adapter - Handles DOM, Indexing, and Diffing
console.log("[AgentAnything] Target Adapter Loaded");

// --- STATE ---
let elementMap = new Map(); // id -> element
let nextId = 1;
let lastSnapshot = null;
let mutationTimer = null;

// --- OVERLAY SYSTEM ---
let shadowHost, shadowRoot;

function ensureOverlay() {
    if (shadowHost && shadowHost.isConnected) return;
    shadowHost = document.createElement('div');
    shadowHost.id = 'aa-overlay-host';
    shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        .aa-highlight {
            position: fixed;
            border: 2px solid #00ff00;
            background: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            z-index: 2147483647;
            border-radius: 4px;
            transition: all 0.2s ease;
        }
        .aa-label {
            position: absolute;
            top: -18px;
            left: 0;
            background: #00ff00;
            color: #000;
            font-family: monospace;
            font-size: 10px;
            padding: 2px 4px;
            border-radius: 2px;
            font-weight: bold;
        }
    `;
    shadowRoot.appendChild(style);
}

function showOverlay(id, rect) {
    ensureOverlay();
    // Clean old
    const old = shadowRoot.getElementById(`aa-hl-${id}`);
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = `aa-hl-${id}`;
    div.className = 'aa-highlight';
    div.style.left = rect.left + 'px';
    div.style.top = rect.top + 'px';
    div.style.width = rect.width + 'px';
    div.style.height = rect.height + 'px';

    div.innerHTML = `<div class="aa-label">${id}</div>`;
    shadowRoot.appendChild(div);

    // Auto remove after 2s
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 200);
    }, 2000);
}


// --- PII REDACTION ---

function redactPII(text) {
    if (!text || typeof text !== 'string') return text;
    // Email
    text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
    // Phone (US format mostly)
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE_REDACTED]');
    // Credit Card (Simple 16 digit check)
    text = text.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[CC_REDACTED]');
    return text;
}


// --- SEMANTIC DOM ---

function isInteractive(el) {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    const type = el.type;
    return (
        tag === 'A' ||
        tag === 'BUTTON' ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        role === 'button' ||
        role === 'link' ||
        role === 'checkbox' ||
        role === 'menuitem' ||
        el.getAttribute('contenteditable') === 'true' ||
        el.onclick !== null
    );
}

function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function getOrAssignId(el) {
    if (el.dataset.agentId) return parseInt(el.dataset.agentId);
    const id = nextId++;
    el.dataset.agentId = id;
    elementMap.set(id, el);
    return id;
}

function buildSemanticNode(el) {
    // Skip noise
    if (el.nodeType !== Node.ELEMENT_NODE) return null;
    if (!isVisible(el)) return null;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'meta', 'link', 'svg', 'path'].includes(tag)) return null;

    const interactive = isInteractive(el);
    let node = {
        tag: tag
    };

    if (interactive) {
        node.id = getOrAssignId(el);
        node.interactive = true;
    }

    // Attributes
    if (el.value) node.value = redactPII(el.value);
    if (el.placeholder) node.placeholder = redactPII(el.placeholder);
    if (el.name) node.name = redactPII(el.name);
    if (el.getAttribute('aria-label')) node.ariaLabel = redactPII(el.getAttribute('aria-label'));
    if (tag === 'a' && el.href) node.href = el.href; // hrefs usually not redacted unless containing token? Leaving for now.

    // Children
    const children = [];
    if (el.childNodes && el.childNodes.length > 0) {
        el.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text.length > 0) children.push(redactPII(text.substring(0, 100))); // Truncate and redact
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childNode = buildSemanticNode(child);
                if (childNode) children.push(childNode);
            }
        });
    }

    if (children.length > 0) node.children = children;

    return node;
}

function generateSnapshot() {
    elementMap.clear();
    return buildSemanticNode(document.body);
}


// --- DIFFING & OBSERVING ---

function checkChanges() {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
        const snapshot = generateSnapshot();
        const json = JSON.stringify(snapshot);

        // Simple diff: if stringified JSON changed
        if (json !== lastSnapshot) {
            lastSnapshot = json;
            console.log("DOM Changed, sending update.");
            chrome.runtime.sendMessage({
                action: "TARGET_UPDATE",
                payload: { content: json, url: window.location.href }
            });
        }
    }, 500); // Debounce 500ms
}

const observer = new MutationObserver(checkChanges);


// --- MESSAGING ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "INIT_TARGET") {
        console.log("Target Initialized");
        checkChanges();
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }

    if (msg.action === "GET_COORDINATES") {
        const id = msg.id;
        const el = elementMap.get(parseInt(id));
        if (el) {
            const rect = el.getBoundingClientRect();
            showOverlay(id, rect);
            // Return center coordinates
            sendResponse({
                x: rect.left + (rect.width / 2),
                y: rect.top + (rect.height / 2),
                found: true
            });
        } else {
            sendResponse({ found: false });
        }
        return true; // async response
    }

    // Fallback for direct execution if Debugger fails or not used
    if (msg.action === "EXECUTE_COMMAND") {
         // ... implementation for direct JS execution if needed
    }

    if (msg.action === "DISENGAGE_LOCAL") {
        observer.disconnect();
        window.location.reload();
    }
});
