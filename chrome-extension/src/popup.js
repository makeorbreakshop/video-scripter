import { parseYouTubeUrl, enqueue, flushBuffer, fetchView } from './shared.js';

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
    $('quota').textContent = `API ${stats.quota_today.toLocaleString()}/${stats.quota_limit.toLocaleString()}`;
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

async function renderQueue() {
  try {
    const rows = await fetchView('ext_recent');
    $('queue').innerHTML = rows
      .map((r) => {
        const icon = r.done ? '\u2705' : '\u23f3';
        const label = (r.result || '').startsWith('already') ? 'known' : r.done ? 'in' : 'importing soon';
        return `<div>${icon} <span class="nm">${r.display_name}</span> <span style="color:#888">[${r.mode}]</span> <span style="color:#6a6">${label}</span></div>`;
      })
      .join('') || '<div style="color:#777">empty</div>';
  } catch {
    $('queue').textContent = 'queue unavailable';
  }
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
setInterval(() => { renderQueue(); renderStats(); }, 7000);
