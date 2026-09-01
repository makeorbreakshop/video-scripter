// Feed logger: collects video IDs from links rendered on YouTube pages.
// IDs only — backend fetches all real data via the official API.
// Reacts live to the passive toggle (no page reload needed). Default: ON.
const seen = new Set();
let observer = null;
let timer = null;

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
    chrome.runtime.sendMessage({ type: 'feedIds', ids: found, page: location.pathname }).catch?.(() => {});
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

chrome.storage.local.get('passive').then(({ passive = true }) => {
  if (passive) startObserving();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'passive' in changes) {
    changes.passive.newValue ? startObserving() : stopObserving();
  }
});
