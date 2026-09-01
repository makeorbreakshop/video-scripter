// Feed logger + on-page status badges.
// Captures video IDs from links (IDs only; backend fetches real data via the
// official API) and overlays each thumbnail with its tracking status:
//   ✓ tracked (in the corpus)  ⏳ importing  ◉ captured just now
// Reacts live to the passive toggle. Default: ON.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const seen = new Set();
const status = new Map(); // videoId -> 'tracked' | 'queued' | 'captured'
let observer = null;
let timer = null;

const CSS = `
.ci-badge { position:absolute; top:6px; left:6px; z-index:100; font:600 11px -apple-system,sans-serif;
  padding:2px 7px; border-radius:10px; pointer-events:none; color:#fff; opacity:.92; }
.ci-tracked { background:#2e7d32; }
.ci-queued { background:#b26a00; }
.ci-captured { background:#455a64; animation: ci-pulse 1.2s ease-in-out 2; }
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

async function lookupStatuses(ids) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  for (let i = 0; i < ids.length; i += 50) {
    const grp = ids.slice(i, i + 50);
    const inList = `(${grp.join(',')})`;
    try {
      const [vids, q] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/videos?select=id&id=in.${inList}`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${SUPABASE_URL}/rest/v1/touch_queue?select=ref,processed_at&kind=eq.video&ref=in.${inList}`, { headers }).then((r) => (r.ok ? r.json() : [])),
      ]);
      for (const v of vids) status.set(v.id, 'tracked');
      for (const r of q) if (!status.has(r.ref)) status.set(r.ref, r.processed_at ? 'captured' : 'queued');
    } catch { /* offline */ }
  }
}

function badge(el, cls, text) {
  const host = el.closest('ytd-thumbnail, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-video-renderer') || el;
  const existing = host.querySelector('.ci-badge');
  if (existing) {
    existing.className = `ci-badge ${cls}`;
    existing.textContent = text;
    return;
  }
  const container = el.querySelector('img')?.parentElement || el;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const b = document.createElement('span');
  b.className = `ci-badge ${cls}`;
  b.textContent = text;
  container.appendChild(b);
}

function paintBadges() {
  for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
    if (!a.querySelector('img')) continue; // thumbnails only, skip title links
    const id = idFromAnchor(a);
    if (!id || !status.has(id)) continue;
    const st = status.get(id);
    if (st === 'tracked') badge(a, 'ci-tracked', '✓ tracked');
    else if (st === 'queued') badge(a, 'ci-queued', '⏳ importing');
    else badge(a, 'ci-captured', '◉ captured');
  }
}

async function collectIds() {
  const found = [];
  const pageIds = [];
  for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
    const id = idFromAnchor(a);
    if (!id) continue;
    pageIds.push(id);
    if (!seen.has(id)) {
      seen.add(id);
      const hint = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '')
        .trim().slice(0, 80);
      found.push({ id, hint });
    }
  }
  if (found.length) {
    chrome.runtime.sendMessage({ type: 'feedIds', items: found, page: location.pathname }).catch?.(() => {});
    for (const f of found) if (!status.has(f.id)) status.set(f.id, 'captured');
  }
  const unknown = [...new Set(pageIds)].filter((id) => !status.has(id) || status.get(id) === 'captured');
  if (unknown.length) await lookupStatuses(unknown);
  paintBadges();
}

function startObserving() {
  if (observer) return;
  injectCss();
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
  document.querySelectorAll('.ci-badge').forEach((b) => b.remove());
}

chrome.storage.local.get('passive').then(({ passive = true }) => {
  if (passive) startObserving();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'passive' in changes) {
    changes.passive.newValue ? startObserving() : stopObserving();
  }
});
