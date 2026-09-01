"use strict";
(() => {
  // chrome-extension/src/content.js
  var seen = /* @__PURE__ */ new Set();
  var observer = null;
  var timer = null;
  function collectIds() {
    const found = [];
    for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
      const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        const hint = (a.getAttribute("title") || a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 80);
        found.push({ id: m[1], hint });
      }
    }
    if (found.length) {
      chrome.runtime.sendMessage({ type: "feedIds", items: found, page: location.pathname }).catch?.(() => {
      });
    }
  }
  function startObserving() {
    if (observer) return;
    collectIds();
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(collectIds, 1500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function stopObserving() {
    observer?.disconnect();
    observer = null;
  }
  chrome.storage.local.get("passive").then(({ passive = true }) => {
    if (passive) startObserving();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "passive" in changes) {
      changes.passive.newValue ? startObserving() : stopObserving();
    }
  });
})();
