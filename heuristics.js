/**
 * The Heuristic Engine.
 * Attempts to derive meaning from tag soup.
 */
const Heuristics = {
  
  // Weights for determining importance
  weights: {
    input: 10,
    button: 5,
    area: 2,
    centrality: 3,
    visibility: 5
  },

  // Recursive crawler to pierce Shadow DOMs where possible
  getAllElements: function(root = document.body) {
    let elements = [];
    if (root.tagName === 'INPUT' || root.tagName === 'BUTTON' || root.tagName === 'TEXTAREA' || root.tagName === 'A') {
      elements.push(root);
    }
    
    if (root.shadowRoot) {
      elements = elements.concat(this.getAllElements(root.shadowRoot));
    }
    
    if (root.children) {
      for (let child of root.children) {
        elements = elements.concat(this.getAllElements(child));
      }
    }
    return elements;
  },

  scoreElement: function(el) {
    let score = 0;
    const rect = el.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === 'none') {
      return -9999;
    }

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const elCenterX = rect.left + rect.width / 2;
    const elCenterY = rect.top + rect.height / 2;
    const dist = Math.sqrt(Math.pow(centerX - elCenterX, 2) + Math.pow(centerY - elCenterY, 2));
    score -= dist * 0.01;

    if (el.tagName === 'INPUT') {
      const type = el.getAttribute('type') || 'text';
      if (['text', 'search', 'email', 'url'].includes(type)) score += 20;
      if (type === 'password') score -= 100;
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
    
    all.forEach((el, idx) => {
      const score = this.scoreElement(el);
      if (score > 5) {
        if (!el.dataset.aaId) {
          el.dataset.aaId = `aa-${Math.random().toString(36).substr(2, 9)}`;
        }

        map.push({
          id: el.dataset.aaId,
          tag: el.tagName.toLowerCase(),
          type: el.type || null,
          text: (el.innerText || el.placeholder || el.value || "").substring(0, 30).trim(),
          score: score,
          element: el
        });
      }
    });

    return map.sort((a, b) => b.score - a.score).slice(0, 20);
  },

  findMainContent: function() {
    let candidates = Array.from(document.querySelectorAll('div, main, article, section'));
    
    candidates.sort((a, b) => {
      const areaA = a.offsetWidth * a.offsetHeight;
      const areaB = b.offsetWidth * b.offsetHeight;
      return areaB - areaA;
    });

    return candidates.find(c => c !== document.body && c.innerText.length > 50) || document.body;
  }
};
