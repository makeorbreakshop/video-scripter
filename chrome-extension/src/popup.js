import { parseYouTubeUrl, enqueue, flushBuffer, fetchView } from './shared.js';
import { LOCAL_API } from './config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? '–'));

// tabs
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  };
});

async function renderStats() {
  try {
    const [stats] = await fetchView('ext_stats');
    if (!stats) return;
    $('s-ch').textContent = fmt(stats.channels_tracked);
    $('s-vid').textContent = fmt(stats.videos_est);
    $('s-snap').textContent = fmt(stats.snapshots_today);
    $('s-q').textContent = stats.queue_pending;
    $('s-done').textContent = stats.processed_today;
    $('quota').textContent = `API ${stats.quota_today.toLocaleString()}/${stats.quota_limit.toLocaleString()} \u00b7 discovery ${stats.discovery_today}/${stats.discovery_cap}`;
    $('s-cost').textContent = `quota ${Math.round((stats.quota_today / stats.quota_limit) * 100)}% used`;
  } catch { /* offline */ }
}

async function renderChart() {
  try {
    const days = await fetchView('ext_growth');
    const max = Math.max(...days.map((d) => d.videos_added), 1);
    $('chart').innerHTML = days
      .map((d) => `<div style="height:${Math.max(4, (d.videos_added / max) * 100)}%" title="${d.day}: ${d.videos_added.toLocaleString()}"></div>`)
      .join('');
  } catch { /* offline */ }
}

async function renderCandidates() {
  try {
    const rows = await fetchView('ext_candidates');
    document.getElementById('cands').innerHTML = rows
      .map((r) => `<div>${dot(r.status === 'enrolled' ? 'ok' : 'idle')}<span class="nm">${r.channel_title}</span> <span class="meta">${(r.subscriber_count/1000).toFixed(0)}K subs \u00b7 seen ${r.seen_count}\u00d7 \u00b7 ${r.status}</span></div>`)
      .join('') || '<div style="color:#777">none yet \u2014 browse YouTube with passive logging on</div>';
  } catch { /* offline */ }
}

async function renderQueue() {
  try {
    const rows = await fetchView('ext_recent');
    $('queue').innerHTML = rows
      .map((r) => {
        const label = (r.result || '').startsWith('already') ? 'known' : r.done ? 'in' : 'importing soon';
        return `<div>${dot(r.done ? 'ok' : 'warn')}<span class="nm">${r.display_name}</span> <span class="meta">${r.mode} \u00b7 ${label}</span></div>`;
      })
      .join('') || '<div style="color:#777">empty</div>';
  } catch {
    $('queue').textContent = 'queue unavailable';
  }
}

function dot(state) {
  return `<span class="dot ${state}"></span>`;
}

function hrow(k, v, sub = '') {
  return `<div class="hrow"><span class="k">${k}</span><span class="v">${v}${sub ? `<small>${sub}</small>` : ''}</span></div>`;
}

async function renderHealth() {
  const manifestVer = chrome.runtime.getManifest().version;
  $('ver').textContent = `v${manifestVer}`;
  const rows = [];
  let hint = '';

  // 1. Content script on the current YouTube tab — running? which version?
  const tab = await findYouTubeTab();
  if (!tab) {
    rows.push(hrow('content script', `${dot('idle')}no YouTube tab open`));
  } else {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'ci-ping' });
      const stale = pong.version !== manifestVer;
      rows.push(
        hrow(
          'content script',
          `${dot(stale ? 'warn' : pong.observing ? 'ok' : 'warn')}v${pong.version}${stale ? ' (stale)' : ''}`,
          `${pong.badgesPainted} badges · ${pong.idsKnown} ids known · passive ${pong.observing ? 'on' : 'off'}`
        )
      );
      if (stale) hint = 'Old bundle still running — refresh the YouTube tab.';
      const ll = pong.lastLookup;
      rows.push(
        ll
          ? hrow(
              'last lookup',
              `${dot(ll.ok ? 'ok' : 'bad')}${ll.ok ? 'ok' : ll.error || `HTTP ${ll.status}`}`,
              `${ll.asked} ids · ${Math.round((Date.now() - ll.at) / 1000)}s ago`
            )
          : hrow('last lookup', `${dot('idle')}none yet`)
      );
    } catch {
      rows.push(hrow('content script', `${dot('bad')}not responding`));
      hint = 'Content script not loaded — reload the extension in chrome://extensions, then refresh the YouTube tab.';
    }
  }

  // 2. Local app (all reads go through it).
  try {
    const t0 = performance.now();
    const res = await fetch(`${LOCAL_API}/api/extension/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    rows.push(
      hrow(
        'local app',
        `${dot(res.ok ? 'ok' : 'bad')}${res.ok ? 'up' : `HTTP ${res.status}`}`,
        `${LOCAL_API} · ${Math.round(performance.now() - t0)}ms`
      )
    );
  } catch {
    rows.push(hrow('local app', `${dot('bad')}down`, `${LOCAL_API} — start the dev server for live badges`));
  }

  // 3. Supabase write buffer.
  const { pending = [], lastSync, trackedCache = [] } = await chrome.storage.local.get([
    'pending',
    'lastSync',
    'trackedCache',
  ]);
  rows.push(
    hrow(
      'capture buffer',
      `${dot(pending.length > 100 ? 'warn' : 'ok')}${pending.length} pending`,
      lastSync ? `last flush ${Math.round((Date.now() - lastSync) / 60000)}m ago` : 'never flushed'
    )
  );
  rows.push(hrow('tracked cache', `${trackedCache.length} ids`));

  $('health').innerHTML = rows.join('');
  $('health-hint').textContent = hint;
}

async function findYouTubeTab() {
  // popup may be a detached window (Dia); check last-focused, then any YT tab
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.url && parseYouTubeUrl(active.url)) return active;
  const ytTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  return ytTabs.find((t) => t.active && parseYouTubeUrl(t.url)) || ytTabs.find((t) => parseYouTubeUrl(t.url)) || null;
}

async function init() {
  const { passive = true } = await chrome.storage.local.get('passive');
  $('passive').checked = passive;

  const tab = await findYouTubeTab();
  const parsed = tab?.url ? parseYouTubeUrl(tab.url) : null;
  if (parsed) {
    $('no-page').hidden = true;
    $('detected').hidden = false;
    $('ingest').hidden = false;
    $('detected').textContent = `${parsed.kind}: ${parsed.ref}`;
    $('ingest').textContent = parsed.kind === 'video' ? 'Ingest video + its channel' : 'Ingest channel';
    $('ingest').onclick = async () => {
      $('ingest').disabled = true;
      const res = await enqueue([{ ...parsed, source_url: tab.url.split('&')[0], mode: 'click' }]);
      $('status').textContent = res.ok ? 'Queued — ingests within ~5 min' : `Failed (${res.status})`;
      $('ingest').disabled = false;
      renderQueue();
    };
  }

  $('passive').onchange = (e) => chrome.storage.local.set({ passive: e.target.checked });
  $('sync').onclick = async (e) => {
    e.preventDefault();
    const res = await flushBuffer();
    $('status').textContent = res.ok ? `Synced ${res.sent}` : `Sync failed (${res.status})`;
    renderQueue();
    renderStats();
  };
}

init();
renderStats();
renderChart();
renderQueue();
renderCandidates();
renderHealth();
setInterval(() => { renderQueue(); renderStats(); renderCandidates(); renderHealth(); }, 7000);
