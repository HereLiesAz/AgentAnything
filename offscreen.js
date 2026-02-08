// Keeps the service worker alive by receiving messages
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target === 'offscreen' && msg.action === 'ping') {
        console.debug("Ping received");
    }
});
