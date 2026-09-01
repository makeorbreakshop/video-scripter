"use strict";
(() => {
  // chrome-extension/src/config.js
  var SUPABASE_URL = "https://mhzwrynnfphlxqcqytrj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oendyeW5uZnBobHhxY3F5dHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyODk5NDAsImV4cCI6MjA1Njg2NTk0MH0.NkZifWOs5IGpQmwbUOYLVRJ2iJskGlh3ggLSuMoxmUk";

  // chrome-extension/src/shared.js
  function parseYouTubeUrl(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
      const v = u.searchParams.get("v");
      if (u.pathname === "/watch" && v) return { kind: "video", ref: v };
      const ch = u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
      if (ch) return { kind: "channel", ref: ch[1] };
      const h = u.pathname.match(/^\/(@[A-Za-z0-9._-]{3,60})/);
      if (h) return { kind: "handle", ref: h[1] };
      return null;
    } catch {
      return null;
    }
  }
  async function enqueue(items) {
    if (!items.length) return { ok: true, sent: 0 };
    items = items.map((i) => ({
      kind: i.kind,
      ref: i.ref,
      source_url: i.source_url || null,
      mode: i.mode || "click",
      hint: i.hint || null
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue?on_conflict=kind,ref`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify(items)
    });
    return { ok: res.ok, sent: items.length, status: res.status };
  }
  async function bufferAdd(item) {
    const { pending = [], submitted = [] } = await chrome.storage.local.get(["pending", "submitted"]);
    const key = `${item.kind}:${item.ref}`;
    if (submitted.includes(key)) return;
    if (pending.some((p) => p.kind === item.kind && p.ref === item.ref)) return;
    pending.push(item);
    await chrome.storage.local.set({ pending });
  }
  async function flushBuffer() {
    const { pending = [], submitted = [] } = await chrome.storage.local.get(["pending", "submitted"]);
    if (!pending.length) return { ok: true, sent: 0 };
    const res = await enqueue(pending);
    if (res.ok) {
      const merged = [...submitted, ...pending.map((p) => `${p.kind}:${p.ref}`)].slice(-5e3);
      await chrome.storage.local.set({ pending: [], submitted: merged, lastSync: Date.now() });
    }
    return res;
  }

  // chrome-extension/src/background.js
  chrome.runtime.onInstalled.addListener(async () => {
    chrome.alarms.create("flush", { periodInMinutes: 1 });
    const cur = await chrome.storage.local.get("passive");
    if (!("passive" in cur)) await chrome.storage.local.set({ passive: true });
    const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    for (const t of tabs) {
      if (!t.id) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] });
      } catch {
      }
    }
  });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name === "flush") {
      try {
        await flushBuffer();
      } catch {
      }
    }
  });
  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    const { passive = true } = await chrome.storage.local.get("passive");
    if (!passive) return;
    const parsed = parseYouTubeUrl(tab.url);
    if (!parsed) return;
    await bufferAdd({ ...parsed, source_url: tab.url.split("&")[0], mode: "passive" });
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "feedIds" && Array.isArray(msg.items)) {
      (async () => {
        for (const it of msg.items.slice(0, 200)) {
          if (/^[A-Za-z0-9_-]{6,20}$/.test(it.id)) {
            await bufferAdd({ kind: "video", ref: it.id, source_url: `feed:${msg.page || ""}`, mode: "feed", hint: it.hint || null });
          }
        }
        const { pending = [] } = await chrome.storage.local.get("pending");
        if (pending.length >= 15) {
          try {
            await flushBuffer();
          } catch {
          }
        }
      })();
    }
  });
})();
