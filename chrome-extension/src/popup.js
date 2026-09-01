import { parseYouTubeUrl, enqueue, flushBuffer, fetchQueue } from './shared.js';

const $ = (id) => document.getElementById(id);

async function refreshPending() {
  const { pending = [] } = await chrome.storage.local.get('pending');
  $('pcount').textContent = pending.length;
}

async function init() {
  const { passive = false } = await chrome.storage.local.get('passive');
  $('passive').checked = passive;
  await refreshPending();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = tab?.url ? parseYouTubeUrl(tab.url) : null;
  if (parsed) {
    $('detected').textContent = `${parsed.kind}: ${parsed.ref}`;
    $('ingest').disabled = false;
    $('ingest').textContent = parsed.kind === 'video' ? 'Ingest video + its channel' : 'Ingest channel';
    $('ingest').onclick = async () => {
      $('ingest').disabled = true;
      const res = await enqueue([{ ...parsed, source_url: tab.url.split('&')[0], mode: 'click' }]);
      $('status').textContent = res.ok ? 'Queued — imported by tonight\'s run' : `Failed (${res.status})`;
      $('ingest').disabled = false;
    };
  }

  $('passive').onchange = (e) => chrome.storage.local.set({ passive: e.target.checked });
  $('sync').onclick = async () => {
    const res = await flushBuffer();
    $('status').textContent = res.ok ? `Synced ${res.sent}` : `Sync failed (${res.status})`;
    await refreshPending();
  };
}

async function renderQueue() {
  try {
    const rows = await fetchQueue(12);
    document.getElementById('queue').innerHTML = rows
      .map((r) => {
        const done = r.processed_at ? '\u2705' : '\u23f3';
        const label = (r.result || '').startsWith('already') ? 'known' :
                      r.processed_at ? (r.result || 'done').split(':')[0] : 'queued';
        return `<div>${done} <span style="color:#888">[${r.mode}]</span> ${r.ref} <span style="color:#6a6">${label}</span></div>`;
      })
      .join('') || '<div style="color:#777">empty</div>';
  } catch {
    document.getElementById('queue').textContent = 'queue unavailable';
  }
}

init();
renderQueue();
setInterval(renderQueue, 5000);
