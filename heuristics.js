const Heuristics = {
  weights: { input: 10, button: 5, area: 2, centrality: 3, visibility: 5 },

  getAllElements: function(root = document.body) {
    let elements = [];
    if (['INPUT', 'BUTTON', 'TEXTAREA', 'A', 'DIV', 'SPAN', 'FORM'].includes(root.tagName)) elements.push(root);
    if (root.shadowRoot) elements = elements.concat(this.getAllElements(root.shadowRoot));
    if (root.children) for (let child of root.children) elements = elements.concat(this.getAllElements(child));
    return elements;
  },

  getElementByAAId: function(id) {
    const all = this.getAllElements(document.body);
    return all.find(el => el.dataset.aaId === id) || null;
  },

  findBestInput: function() {
    const candidates = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    for (let c of candidates) if (c.offsetParent !== null) return c; 
    const all = this.getAllElements(document.body);
    const deepCandidates = all.filter(el => {
        if (el.offsetParent === null) return false; 
        const tag = el.tagName, role = el.getAttribute('role'), editable = el.getAttribute('contenteditable');
        return tag === 'TEXTAREA' || (tag === 'INPUT' && !['hidden', 'checkbox', 'radio', 'submit'].includes(el.type)) || editable === 'true' || role === 'textbox';
    });
    deepCandidates.sort((a, b) => {
        const rectA = a.getBoundingClientRect(), rectB = b.getBoundingClientRect();
        return (rectB.width * rectB.height) - (rectA.width * rectA.height);
    });
    return deepCandidates[0] || null;
  },

  findSendButton: function() {
    const all = this.getAllElements(document.body);
    return all.find(el => {
        if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
        if (el.disabled) return false;
        const html = (el.outerHTML || "").toLowerCase();
        const label = (el.getAttribute('aria-label') || "").toLowerCase();
        const testId = (el.getAttribute('data-testid') || "").toLowerCase();
        
        return label.includes('send') || label.includes('submit') || testId.includes('send') ||
               html.includes('path d="') || el.innerText.match(/send|go|submit/i) ||
               el.querySelector('svg, img'); // Icon button assumption
    });
  },

  scoreElement: function(el) {
    let score = 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === 'none') return -9999;

    const centerX = window.innerWidth / 2, centerY = window.innerHeight / 2;
    const elCenterX = rect.left + rect.width / 2, elCenterY = rect.top + rect.height / 2;
    const dist = Math.sqrt(Math.pow(centerX - elCenterX, 2) + Math.pow(centerY - elCenterY, 2));
    score -= dist * 0.01;

    if (el.tagName === 'INPUT') {
      const type = el.getAttribute('type') || 'text';
      if (['text', 'search', 'email', 'url'].includes(type)) score += 20;
    }
    if (el.tagName === 'TEXTAREA') score += 25;
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      score += 10;
      if (el.innerText.match(/search|send|submit|go|chat/i)) score += 15;
    }
    if (rect.width > 20 && rect.height > 20) score += 5;
    return score;
  },

  generateMap: function() {
    const all = this.getAllElements();
    const map = [];
    all.forEach((el) => {
      const score = this.scoreElement(el);
      if (score > 5) {
        if (!el.dataset.aaId) el.dataset.aaId = `aa-${Math.random().toString(36).substr(2, 9)}`;
        map.push({ id: el.dataset.aaId, tag: el.tagName.toLowerCase(), type: el.type || null, text: (el.innerText || el.placeholder || el.value || "").substring(0, 30).trim(), score: score });
      }
    });
    return map.sort((a, b) => b.score - a.score).slice(0, 20);
  },

  findMainContent: function() {
    let candidates = Array.from(document.querySelectorAll('div, main, article, section'));
    candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
    return candidates.find(c => c !== document.body && c.innerText.length > 50) || document.body;
  }
};
