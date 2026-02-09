// Network Interceptor - Injected into MAIN world
(function() {
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;
    const fetch = window.fetch;

    function report(method, url, body) {
        // Filter: Only same-domain or relevant APIs
        try {
            const targetUrl = new URL(url, window.location.href);
            // Basic filtering to avoid noise (images, css)
            if (targetUrl.pathname.match(/\.(png|jpg|jpeg|gif|css|js|woff|ttf)$/)) return;

            window.postMessage({
                source: 'AA_NETWORK_HOOK',
                payload: {
                    method,
                    url: targetUrl.pathname + targetUrl.search, // Relative path + query
                    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
                    timestamp: Date.now()
                }
            }, '*');
        } catch(e) {}
    }

    // Hook Fetch
    window.fetch = async function(...args) {
        const [resource, config] = args;
        const method = (config && config.method) || 'GET';
        const body = (config && config.body);
        report(method, resource instanceof Request ? resource.url : resource, body);
        return fetch.apply(window, args);
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
