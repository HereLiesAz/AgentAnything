document.getElementById('acceptBtn').addEventListener('click', () => {
    chrome.storage.sync.set({ privacyAccepted: true }, () => {
        alert("Setup Complete! You can now use the extension.");
        window.close();
    });
});
