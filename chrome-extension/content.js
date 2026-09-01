"use strict";
(() => {
  // chrome-extension/src/content.js
  var seen = /* @__PURE__ */ new Set();
  function collectIds() {
    const found = [];
    for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
      const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        found.push(m[1]);
      }
    }
    if (found.length) {
      chrome.runtime.sendMessage({ type: "feedIds", ids: found, page: location.pathname }).catch?.(() => {
      });
    }
  }
  async function start() {
    const { passive = false } = await chrome.storage.local.get("passive");
    if (!passive) return;
    collectIds();
    const observer = new MutationObserver(() => {
      clearTimeout(start._t);
      start._t = setTimeout(collectIds, 1500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  start();
})();
