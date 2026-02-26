// FIXES: Replaced alert() with inline DOM feedback. Auto-closes after confirmation.
document.getElementById('acceptBtn').addEventListener('click', () => {
    const btn = document.getElementById('acceptBtn');
    btn.disabled = true;
    btn.textContent = 'Enabling...';

    chrome.storage.sync.set({ privacyAccepted: true }, () => {
        if (chrome.runtime.lastError) {
            btn.disabled = false;
            btn.textContent = 'Error — Please Try Again';
            btn.style.background = '#ff4444';
            return;
        }

        // Replace button with a success message — no alert() needed
        btn.style.background = '#00cc00';
        btn.textContent = '✅ AgentAnything Enabled!';

        const container = document.querySelector('.container');
        if (container) {
            const msg = document.createElement('p');
            msg.style.color = '#00ff00';
            msg.style.fontWeight = 'bold';
            msg.style.marginTop = '15px';
            msg.textContent = 'Setup complete. You can close this tab and start using the extension.';
            container.appendChild(msg);
        }

        // Auto-close after 2.5 seconds
        setTimeout(() => window.close(), 2500);
    });
});
