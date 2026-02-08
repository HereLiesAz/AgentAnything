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
    // If it's a leaf node that matters, take it.
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
    
    // 1. Visibility Check
    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === 'none') {
      return -9999;
    }

    // 2. Centrality (Center of screen is prime real estate)
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const elCenterX = rect.left + rect.width / 2;
    const elCenterY = rect.top + rect.height / 2;
    const dist = Math.sqrt(Math.pow(centerX - elCenterX, 2) + Math.pow(centerY - elCenterY, 2));
    score -= dist * 0.01; // Penalize distance

    // 3. Type Scoring
    if (el.tagName === 'INPUT') {
      const type = el.getAttribute('type') || 'text';
      if (['text', 'search', 'email', 'url'].includes(type)) score += 20;
      if (type === 'password') score -= 100; // Agent doesn't need your passwords.
    }
    if (el.tagName === 'TEXTAREA') score += 25; // Likely a chat input or comment box.
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      score += 10;
      if (el.innerText.match(/search|send|submit|go|chat/i)) score += 15;
    }

    // 4. Size (Tiny buttons are usually config/trash)
    if (rect.width > 20 && rect.height > 20) score += 5;

    return score;
  },

  generateMap: function() {
    const all = this.getAllElements();
    const map = [];
    
    all.forEach((el, idx) => {
      const score = this.scoreElement(el);
      if (score > 5) {
        // Assign ID if missing
        if (!el.dataset.aaId) {
          el.dataset.aaId = `aa-${Math.random().toString(36).substr(2, 9)}`;
        }

        map.push({
          id: el.dataset.aaId,
          tag: el.tagName.toLowerCase(),
          type: el.type || null,
          text: (el.innerText || el.placeholder || el.value || "").substring(0, 30).trim(),
          score: score,
          element: el // Reference for internal use, strip before JSON
        });
      }
    });

    // Sort by relevance
    return map.sort((a, b) => b.score - a.score).slice(0, 20); // Top 20 interactables only. Keep context window small.
  },

  // Identify the likely "Content Area" (e.g., search results, chat history)
  findMainContent: function() {
    // Look for the largest block of text that changes or contains many children
    let candidates = Array.from(document.querySelectorAll('div, main, article, section'));
    
    // Sort by text length * visible area
    candidates.sort((a, b) => {
      const areaA = a.offsetWidth * a.offsetHeight;
      const areaB = b.offsetWidth * b.offsetHeight;
      return areaB - areaA;
    });

    // Return the top candidate that isn't the body itself
    return candidates.find(c => c !== document.body && c.innerText.length > 50) || document.body;
  }
};
