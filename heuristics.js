/**
 * Heuristics Engine (Type-6 Hardened)
 * Traverses deep Shadow DOM trees to locate interactive elements.
 * Shared utility for both Agent and Target roles.
 */
const Heuristics = {
  
  weights: {
    input: 10,
    button: 5,
    area: 2,
    centrality: 3,
    visibility: 5
  },

  getAllElements: function(root = document.body) {
    let elements = [];
    if (!root) return elements;

    if (root.nodeType === Node.ELEMENT_NODE) {
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

  getElementByAAId: function(id) {
    // Brute force find across all shadow roots
    const all = this.getAllElements(document.body);
    return all.find(el => el.dataset.aaId === id) || null;
  },

  findBestInput: function() {
    if (document.activeElement && 
       (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' || 
        document.activeElement.getAttribute('contenteditable') === 'true')) {
        return document.activeElement;
    }

    const all = this.getAllElements(document.body);
    const deepCandidates = all.filter(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false; 
        
        const tag = el.tagName;
        const role = el.getAttribute('role');
        const editable = el.getAttribute('contenteditable');

        return tag === 'TEXTAREA' || 
               (tag === 'INPUT' && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'image'].includes(el.type)) ||
               editable === 'true' ||
               role === 'textbox';
    });
    
    // Sort by size (Chat inputs are usually the largest text area on screen)
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
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return false; // Too small

        const txt = (el.innerText || "").toLowerCase();
        const aria = (el.getAttribute('aria-label') || "").toLowerCase();
        const testId = (el.getAttribute('data-testid') || "").toLowerCase();

        const isButton = el.tagName === 'BUTTON' || 
                         el.getAttribute('role') === 'button' || 
                         el.type === 'submit';
                         
        const isSendy = txt.includes('send') || aria.includes('send') || testId.includes('send') ||
                        txt.includes('submit') || el.querySelector('svg');

        return isButton && isSendy;
    });
  },

  generateMap: function() {
    // Generate a map of interactive elements for the Agent to click
    const all = this.getAllElements();
    return all.filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return false;
        
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA') return true;
        if (el.getAttribute('role') === 'button') return true;
        return false;
    }).slice(0, 20).map(el => { // Limit to top 20 to save tokens
        if (!el.dataset.aaId) {
          el.dataset.aaId = `aa-${Math.random().toString(36).substr(2, 5)}`;
        }
        return {
          id: el.dataset.aaId,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.value || "").substring(0, 20).replace(/\n/g, ' ')
        };
    });
  },

  findMainContent: function() {
    let candidates = Array.from(document.querySelectorAll('div, main, article, section'));
    candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
    return candidates[0] || document.body;
  }
};
