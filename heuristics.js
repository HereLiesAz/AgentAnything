/**
 * Heuristics Engine (Type-6 Hardened)
 * Traverses deep Shadow DOM trees to locate interactive elements.
 * Prioritizes visibility and centrality.
 */
const Heuristics = {
  
  weights: {
    input: 10,
    button: 5,
    area: 2,
    centrality: 3,
    visibility: 5
  },

  /**
   * Recursively gathers all elements, piercing Shadow Roots.
   */
  getAllElements: function(root = document.body) {
    let elements = [];
    if (!root) return elements;

    // Add current if it's an element
    if (root.nodeType === Node.ELEMENT_NODE) {
        elements.push(root);
    }
    
    // Traverse Shadow Root
    if (root.shadowRoot) {
      elements = elements.concat(this.getAllElements(root.shadowRoot));
    }
    
    // Traverse Children
    if (root.children) {
      for (let child of root.children) {
        elements = elements.concat(this.getAllElements(child));
      }
    }
    return elements;
  },

  getElementByAAId: function(id) {
    const all = this.getAllElements(document.body);
    return all.find(el => el.dataset.aaId === id) || null;
  },

  findBestInput: function() {
    // 1. Check for standard active element first
    if (document.activeElement && 
       (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' || 
        document.activeElement.getAttribute('contenteditable') === 'true')) {
        return document.activeElement;
    }

    const all = this.getAllElements(document.body);
    
    // 2. Filter for valid inputs
    const deepCandidates = all.filter(el => {
        // Must be visible
        if (el.offsetParent === null && window.getComputedStyle(el).display === 'none') return false; 
        
        const tag = el.tagName;
        const role = el.getAttribute('role');
        const editable = el.getAttribute('contenteditable');

        return tag === 'TEXTAREA' || 
               (tag === 'INPUT' && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'image'].includes(el.type)) ||
               editable === 'true' ||
               role === 'textbox';
    });
    
    // 3. Sort by size (heuristic: main chat inputs are usually large or wide)
    deepCandidates.sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectB.width * rectB.height) - (rectA.width * rectA.height);
    });

    return deepCandidates[0] || null;
  },

  findSendButton: function() {
    const all = this.getAllElements(document.body);
    return all.find(el => {
        // Must be visible
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return false;

        // Semantic checks
        if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
        if (el.disabled) return false;
        
        const html = (el.outerHTML || "").toLowerCase();
        const label = (el.getAttribute('aria-label') || "").toLowerCase();
        const testId = (el.getAttribute('data-testid') || "").toLowerCase();
        const text = (el.innerText || "").toLowerCase();
        
        return label.includes('send') || 
               label.includes('submit') || 
               testId.includes('send') ||
               testId.includes('submit') ||
               html.includes('path d="') ||  // SVG icons often indicate send buttons
               text === 'send' ||
               text === 'submit' ||
               text === 'go';
    });
  },

  scoreElement: function(el) {
    let score = 0;
    const rect = el.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === 'none') {
      return -9999;
    }

    // Distance from center
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
      const t = (el.innerText || "").toLowerCase();
      if (t.match(/search|send|submit|go|chat/i)) score += 15;
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
