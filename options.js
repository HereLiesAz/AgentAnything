// CORTEX STORAGE LOGIC

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('add-domain').addEventListener('click', addDomainRow);

function saveOptions() {
  const universal = document.getElementById('universal-context').value;
  const domainRows = document.querySelectorAll('.domain-row');
  const domainContexts = {};

  domainRows.forEach(row => {
    const domain = row.querySelector('.domain-input').value.trim();
    const context = row.querySelector('.context-input').value.trim();
    if (domain && context) {
      domainContexts[domain] = context;
    }
  });

  chrome.storage.sync.set({
    universalContext: universal,
    domainContexts: domainContexts
  }, () => {
    const status = document.getElementById('status');
    status.textContent = '>> Memory Engram Saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });
}

function restoreOptions() {
  chrome.storage.sync.get({
    universalContext: '',
    domainContexts: {}
  }, (items) => {
    document.getElementById('universal-context').value = items.universalContext;
    
    // Clear existing
    const list = document.getElementById('domain-list');
    list.innerHTML = '';

    // Populate domains
    for (const [domain, context] of Object.entries(items.domainContexts)) {
      addDomainRow(null, domain, context);
    }
  });
}

function addDomainRow(e, domain = '', context = '') {
  const container = document.getElementById('domain-list');
  const row = document.createElement('div');
  row.className = 'domain-row';

  row.innerHTML = `
    <input type="text" class="domain-input" placeholder="domain.com" value="${domain}">
    <input type="text" class="context-input" placeholder="Specific instructions..." value="${context}">
    <button class="delete-btn">X</button>
  `;

  row.querySelector('.delete-btn').addEventListener('click', () => {
    container.removeChild(row);
  });

  container.appendChild(row);
}
