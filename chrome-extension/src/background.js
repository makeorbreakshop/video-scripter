// Passive mode: when enabled, log the channels/videos Brandon actually views
// (URL-level only) into a local buffer; flush to the touch_queue every 5 min.
import { parseYouTubeUrl, bufferAdd, flushBuffer } from './shared.js';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('flush', { periodInMinutes: 1 });
  const cur = await chrome.storage.local.get('passive');
  if (!('passive' in cur)) await chrome.storage.local.set({ passive: true });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'flush') {
    try { await flushBuffer(); } catch { /* offline; keep buffering */ }
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const { passive = true } = await chrome.storage.local.get('passive');
  if (!passive) return;
  const parsed = parseYouTubeUrl(tab.url);
  if (!parsed) return;
  await bufferAdd({ ...parsed, source_url: tab.url.split('&')[0], mode: 'passive' });
});

// Feed logger messages from content script (IDs only; mode 'feed')
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'feedIds' && Array.isArray(msg.items)) {
    (async () => {
      for (const it of msg.items.slice(0, 200)) {
        if (/^[A-Za-z0-9_-]{6,20}$/.test(it.id)) {
          await bufferAdd({ kind: 'video', ref: it.id, source_url: `feed:${msg.page || ''}`, mode: 'feed', hint: it.hint || null });
        }
      }
      const { pending = [] } = await chrome.storage.local.get('pending');
      if (pending.length >= 15) { try { await flushBuffer(); } catch { /* offline */ } }
    })();
  }
});
