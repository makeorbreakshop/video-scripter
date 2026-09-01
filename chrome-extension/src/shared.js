// Shared helpers: URL parsing + queue sync. No page scraping — we only ever
// capture IDs/handles from URLs; all real data comes from the official API
// server-side.
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOCAL_API } from './config.js';

export function parseYouTubeUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch' && v) return { kind: 'video', ref: v };
    const ch = u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (ch) return { kind: 'channel', ref: ch[1] };
    const h = u.pathname.match(/^\/(@[A-Za-z0-9._-]{3,60})/);
    if (h) return { kind: 'handle', ref: h[1] };
    return null;
  } catch {
    return null;
  }
}

export async function enqueue(items) {
  if (!items.length) return { ok: true, sent: 0 };
  // PostgREST bulk inserts require identical keys on every row
  items = items.map((i) => ({
    kind: i.kind, ref: i.ref, source_url: i.source_url || null,
    mode: i.mode || 'click', hint: i.hint || null,
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue?on_conflict=kind,ref`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(items),
  });
  return { ok: res.ok, sent: items.length, status: res.status };
}

// Local pending queue (buffered so passive mode batches instead of chatty writes).
// A persistent submitted-cache stops re-sending refs across sessions (server
// dedupes anyway; this just cuts the chatter). Capped at 5000, oldest dropped.
export async function bufferAdd(item) {
  const { pending = [], submitted = [] } = await chrome.storage.local.get(['pending', 'submitted']);
  const key = `${item.kind}:${item.ref}`;
  if (submitted.includes(key)) return;
  if (pending.some((p) => p.kind === item.kind && p.ref === item.ref)) return;
  pending.push(item);
  await chrome.storage.local.set({ pending });
}

export async function flushBuffer() {
  const { pending = [], submitted = [] } = await chrome.storage.local.get(['pending', 'submitted']);
  if (!pending.length) return { ok: true, sent: 0 };
  const res = await enqueue(pending);
  if (res.ok) {
    const merged = [...submitted, ...pending.map((p) => `${p.kind}:${p.ref}`)].slice(-5000);
    await chrome.storage.local.set({ pending: [], submitted: merged, lastSync: Date.now() });
  }
  return res;
}

// Local app first (direct Postgres, unmetered); Supabase REST only as a
// fallback when the app isn't running.
export async function fetchView(view, params = '') {
  try {
    const res = await fetch(`${LOCAL_API}/api/extension/view?name=${view}`);
    if (res.ok) return res.json();
  } catch { /* app down */ }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}${params}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return res.ok ? res.json() : [];
}
