/**
 * Heuristics Engine
 * GLOBAL ATTACHMENT MODE
 */
(function() {
    if (window.AA_Heuristics) return;

    window.AA_Heuristics = {
      getAllElements: function(root = document.body) {
        let elements = [];
        if (!root) return elements;
        if (root.nodeType === Node.ELEMENT_NODE) elements.push(root);
        if (root.shadowRoot) elements = elements.concat(this.getAllElements(root.shadowRoot));
        if (root.children) {
          for (let child of root.children) elements = elements.concat(this.getAllElements(child));
        }
        return elements;
      },
      getElementByAAId: function(id) {
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
        const candidates = all.filter(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false; 
            const tag = el.tagName;
            return tag === 'TEXTAREA' || 
                   (tag === 'INPUT' && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'image'].includes(el.type)) ||
                   el.getAttribute('contenteditable') === 'true' ||
                   el.getAttribute('role') === 'textbox';
        });
        candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            const areaA = rectA.width * rectA.height;
            const areaB = rectB.width * rectB.height;

            // Prioritize contenteditable/rich text areas
            const scoreA = (a.isContentEditable || a.getAttribute('role') === 'textbox') ? areaA * 1.5 : areaA;
            const scoreB = (b.isContentEditable || b.getAttribute('role') === 'textbox') ? areaB * 1.5 : areaB;

            return scoreB - scoreA;
        });
        return candidates[0] || null;
      },
      findSendButton: function() {
        const all = this.getAllElements(document.body);
        return all.find(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return false; 
            const txt = (el.innerText || "").toLowerCase();
            const aria = (el.getAttribute('aria-label') || "").toLowerCase();
            const testId = (el.getAttribute('data-testid') || "").toLowerCase();
            const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.type === 'submit';
            const isSendy = txt.includes('send') || aria.includes('send') || testId.includes('send') || txt.includes('submit') || el.querySelector('svg');
            return isButton && isSendy;
        });
      },
      generateMap: function() {
        const all = this.getAllElements();
        return all.filter(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return false;
            const tag = el.tagName;
            return (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || el.getAttribute('role') === 'button');
        }).slice(0, 100).map(el => {
            if (!el.dataset.aaId) el.dataset.aaId = `aa-${Math.random().toString(36).substr(2, 5)}`;
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
})();
