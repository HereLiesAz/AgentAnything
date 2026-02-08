// Add this inside chrome.runtime.onMessage.addListener
    if (message.action === "GET_LATEST_TARGET") {
        // Synchronous response for the Trap
        if (store.lastTargetPayload) {
            sendResponse({ 
                content: store.lastTargetPayload.content, 
                url: store.lastTargetPayload.url 
            });
        } else {
            sendResponse(null);
        }
        return true; 
    }
