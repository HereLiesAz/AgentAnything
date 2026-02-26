// Network Interceptor - Injected into MAIN world via script tag
(function() {
    const ORIGIN = window.location.origin;

    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;

    const originalFetch = window.fetch;

    function report(method, url, body) {
        try {
            const targetUrl = new URL(url, window.location.href);

            // Filter static assets
            if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|woff2?|ttf|eot|ico)(\?|$)/i.test(targetUrl.pathname)) {
                return;
            }

            window.postMessage({
                source: 'AA_NETWORK_HOOK',
                payload: {
                    method: method || 'GET',
                    url: targetUrl.pathname + targetUrl.search,
                    body: body
                        ? (typeof body === 'string'
                            ? body.slice(0, 500)
                            : safeStringify(body).slice(0, 500))
                        : null,
                    timestamp: Date.now()
                }
            }, ORIGIN);

        } catch (_) {}
    }

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch {
            return '[unserializable body]';
        }
    }

    // =============================
    // Fetch Hook (Transparent)
    // =============================

    function patchedFetch() {
        const args = arguments;
        const resource = args[0];
        const config = args[1] || {};

        const method = config.method || 'GET';
        const body = config.body;

        try {
            const url = resource instanceof Request
                ? resource.url
                : String(resource);

            report(method, url, body);
        } catch (_) {}

        // IMPORTANT: preserve original behavior
        return originalFetch.apply(this, args);
    }

    // Preserve identity characteristics
    Object.defineProperty(patchedFetch, 'name', {
        value: 'fetch'
    });

    patchedFetch.toString = function() {
        return originalFetch.toString();
    };

    window.fetch = patchedFetch;

    // =============================
    // XHR Hook (Transparent)
    // =============================

    XHR.open = function(method, url) {
        this._aa_method = method;
        this._aa_url = url;
        return originalOpen.apply(this, arguments);
    };

    XHR.send = function(body) {
        try {
            report(this._aa_method, this._aa_url, body);
        } catch (_) {}

        return originalSend.apply(this, arguments);
    };

})();
