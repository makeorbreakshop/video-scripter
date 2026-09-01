// Shared helpers: URL parsing + queue sync. No page scraping — we only ever
// capture IDs/handles from URLs; all real data comes from the official API
// server-side.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(items),
  });
  return { ok: res.ok, sent: items.length, status: res.status };
}

// Local pending queue (buffered so passive mode batches instead of chatty writes)
export async function bufferAdd(item) {
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (pending.some((p) => p.kind === item.kind && p.ref === item.ref)) return;
  pending.push(item);
  await chrome.storage.local.set({ pending });
}

export async function flushBuffer() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (!pending.length) return { ok: true, sent: 0 };
  const res = await enqueue(pending);
  if (res.ok) await chrome.storage.local.set({ pending: [], lastSync: Date.now() });
  return res;
}

export async function fetchView(view, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}${params}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return res.ok ? res.json() : [];
}
