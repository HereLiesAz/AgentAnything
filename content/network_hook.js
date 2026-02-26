// Network Interceptor - Injected into MAIN world via script tag
// FIX: Use window.location.origin as target origin for postMessage instead of '*'
//      to prevent fake AA_NETWORK_HOOK messages from external page scripts.
(function() {
    const ORIGIN = window.location.origin;
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;
    const originalFetch = window.fetch;

    function report(method, url, body) {
        try {
            const targetUrl = new URL(url, window.location.href);
            // Filter out static assets to reduce noise
            if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|woff2?|ttf|eot|ico)(\?|$)/i.test(targetUrl.pathname)) return;

            window.postMessage({
                source: 'AA_NETWORK_HOOK',
                payload: {
                    method: method || 'GET',
                    url: targetUrl.pathname + targetUrl.search,
                    body: body ? (typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body).substring(0, 500)) : null,
                    timestamp: Date.now()
                }
            }, ORIGIN); // FIX: was '*' which allowed any page to inject fake messages
        } catch(e) {}
    }

    // Hook Fetch
    window.fetch = async function(...args) {
        const [resource, config] = args;
        const method = (config && config.method) || 'GET';
        const body = (config && config.body);
        report(method, resource instanceof Request ? resource.url : String(resource), body);
        return originalFetch.apply(window, args);
    };

    // Hook XHR
    XHR.open = function(method, url) {
        this._aa_method = method;
        this._aa_url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function(body) {
        report(this._aa_method, this._aa_url, body);
        return send.apply(this, arguments);
    };
})();
