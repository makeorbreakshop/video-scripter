// Feed logger + on-page status badges.
// Captures video IDs from links (IDs only; backend fetches real data via the
// official API) and overlays each thumbnail with its tracking status:
//   ✓ tracked (in the corpus)  ⏳ importing  ◉ captured just now
// Reacts live to the passive toggle. Default: ON.
import { LOCAL_API } from './config.js';
import { findBadgeTargets, markupFingerprint } from '../../lib/extension/badge-targets';
import { hintForAnchor } from '../../lib/extension/feed-hint';
import { classifyBadge, channelRefFromAnchor, normalizeChannelRef } from '../../lib/extension/badge-states';

const EXT_VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return '0'; } })();

const seen = new Set();
const status = new Map(); // videoId -> 'tracked' | 'queued' | 'captured'
const vidChannel = new Map(); // videoId -> raw channel ref (@handle or UC id)
const channelKnown = new Map(); // normalized ref -> boolean
let observer = null;
let timer = null;

const CSS = `
.ci-badge { position:absolute; top:6px; left:6px; z-index:100; font:600 11px -apple-system,sans-serif;
  padding:2px 7px; border-radius:10px; pointer-events:none; color:#fff; opacity:.92; }
.ci-tracked { background:#2e7d32; }
.ci-queued { background:#b26a00; }
.ci-captured { background:#455a64; animation: ci-pulse 1.2s ease-in-out 2; }
.ci-newchannel { background:#0e7490; animation: ci-pulse 1.2s ease-in-out 2; }
@keyframes ci-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
`;

function injectCss() {
  if (document.getElementById('ci-style')) return;
  const el = document.createElement('style');
  el.id = 'ci-style';
  el.textContent = CSS;
  document.documentElement.appendChild(el);
}

function idFromAnchor(a) {
  const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
  return m ? m[1] : null;
}

// 'tracked' is durable, so remember it across sessions and never re-query
// those ids. Capped; oldest dropped.
async function loadTrackedCache() {
  const { trackedCache = [] } = await chrome.storage.local.get('trackedCache');
  for (const id of trackedCache) status.set(id, 'tracked');
}

async function saveTrackedCache() {
  const tracked = [...status.entries()].filter(([, s]) => s === 'tracked').map(([id]) => id);
  await chrome.storage.local.set({ trackedCache: tracked.slice(-8000) });
}

// Diagnostics for the popup's Health tab.
const diag = { lastLookup: null };

async function lookupStatuses(ids) {
  const refs = [...new Set(
    ids.map((id) => vidChannel.get(id)).filter((r) => r && !channelKnown.has(normalizeChannelRef(r)))
  )];
  try {
    const res = await fetch(`${LOCAL_API}/api/extension/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(0, 500), channels: refs.slice(0, 100) }),
    });
    diag.lastLookup = { at: Date.now(), ok: res.ok, status: res.status, asked: ids.length };
    if (!res.ok) return;
    const { tracked = [], queued = [], captured = [], knownChannels = [] } = await res.json();
    for (const id of tracked) status.set(id, 'tracked');
    for (const id of queued) if (!status.has(id)) status.set(id, 'queued');
    for (const id of captured) if (!status.has(id)) status.set(id, 'captured');
    const knownSet = new Set(knownChannels);
    for (const r of refs) {
      const n = normalizeChannelRef(r);
      channelKnown.set(n, knownSet.has(n));
    }
    if (tracked.length) await saveTrackedCache();
  } catch (e) {
    diag.lastLookup = { at: Date.now(), ok: false, error: String(e?.message || e), asked: ids.length };
  }
}

function badge(container, cls, text) {
  const existing = container.querySelector(':scope > .ci-badge');
  if (existing) {
    existing.className = `ci-badge ${cls}`;
    existing.textContent = text;
    return;
  }
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const b = document.createElement('span');
  b.className = `ci-badge ${cls}`;
  b.textContent = text;
  container.appendChild(b);
}

function paintBadges() {
  for (const { id, container } of findBadgeTargets(document)) {
    const ref = vidChannel.get(id);
    const chKnown = ref ? channelKnown.get(normalizeChannelRef(ref)) ?? null : null;
    const spec = classifyBadge(status.get(id) ?? null, chKnown);
    if (spec) badge(container, spec.cls, spec.text);
  }
}

async function collectIds() {
  const found = [];
  const pageIds = [];
  for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
    const id = idFromAnchor(a);
    if (!id) continue;
    pageIds.push(id);
    if (!vidChannel.has(id)) {
      const ref = channelRefFromAnchor(a);
      if (ref) vidChannel.set(id, ref);
    }
    if (!seen.has(id)) {
      seen.add(id);
      found.push({ id, hint: hintForAnchor(a) || null });
    }
  }
  if (found.length) {
    // Orphaned contexts (extension reloaded under this tab) throw synchronously
    // on chrome.* — never let that kill lookup + paint.
    try { chrome.runtime.sendMessage({ type: 'feedIds', items: found, page: location.pathname })?.catch?.(() => {}); } catch { /* orphaned */ }
    for (const f of found) if (!status.has(f.id)) status.set(f.id, 'captured');
  }
  const unknown = [...new Set(pageIds)].filter((id) => !status.has(id) || status.get(id) === 'captured');
  if (unknown.length) await lookupStatuses(unknown);
  paintBadges();
  reportIfBlind();
}

// Phone home when the page clearly has videos but no badge targets — the
// server-side diag log turns unknown YouTube markup into a test fixture.
function reportIfBlind() {
  if (!status.size) return;
  if (findBadgeTargets(document).length > 0) return;
  if (Date.now() - (diag.lastReport || 0) < 60_000) return;
  diag.lastReport = Date.now();
  fetch(`${LOCAL_API}/api/extension/diag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: EXT_VERSION,
      page: location.pathname + location.search.slice(0, 40),
      idsKnown: status.size,
      fingerprint: markupFingerprint(document),
    }),
  }).catch(() => {});
}

function startObserving() {
  if (observer) return;
  injectCss();
  loadTrackedCache().then(collectIds);
  observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(collectIds, 1500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserving() {
  observer?.disconnect();
  observer = null;
  document.querySelectorAll('.ci-badge').forEach((b) => b.remove());
}

// Bootstrap exactly once per version per page. The background script
// re-injects this bundle into open YouTube tabs on every extension update, so
// the guard is what makes that idempotent — and a newer version taking over
// from an orphaned older one is exactly the intended path.
if (window.__ciVersion !== EXT_VERSION) {
  window.__ciVersion = EXT_VERSION;

  // Health ping from the popup: report the RUNNING bundle's version and state.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ci-ping') {
      const targets = findBadgeTargets(document);
      sendResponse({
        version: EXT_VERSION,
        observing: !!observer,
        badgesPainted: document.querySelectorAll('.ci-badge').length,
        idsKnown: status.size,
        targetsFound: targets.length,
        fingerprint: targets.length === 0 ? markupFingerprint(document) : null,
        lastLookup: diag.lastLookup,
      });
    }
  });

  chrome.storage.local.get('passive').then(({ passive = true }) => {
    if (passive) startObserving();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'passive' in changes) {
      changes.passive.newValue ? startObserving() : stopObserving();
    }
  });
}
