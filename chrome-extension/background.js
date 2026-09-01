// Passive mode: when enabled, log the channels/videos Brandon actually views
// (URL-level only) into a local buffer; flush to the touch_queue every 5 min.
import { parseYouTubeUrl, bufferAdd, flushBuffer } from './shared.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('flush', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'flush') {
    try { await flushBuffer(); } catch { /* offline; keep buffering */ }
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const { passive = false } = await chrome.storage.local.get('passive');
  if (!passive) return;
  const parsed = parseYouTubeUrl(tab.url);
  if (!parsed) return;
  await bufferAdd({ ...parsed, source_url: tab.url.split('&')[0], mode: 'passive' });
});
