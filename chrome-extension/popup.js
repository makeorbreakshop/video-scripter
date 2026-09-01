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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates"
      },
      body: JSON.stringify(items)
    });
    return { ok: res.ok, sent: items.length, status: res.status };
  }
  async function flushBuffer() {
    const { pending = [] } = await chrome.storage.local.get("pending");
    if (!pending.length) return { ok: true, sent: 0 };
    const res = await enqueue(pending);
    if (res.ok) await chrome.storage.local.set({ pending: [], lastSync: Date.now() });
    return res;
  }

  // chrome-extension/src/popup.js
  var $ = (id) => document.getElementById(id);
  async function refreshPending() {
    const { pending = [] } = await chrome.storage.local.get("pending");
    $("pcount").textContent = pending.length;
  }
  async function init() {
    const { passive = false } = await chrome.storage.local.get("passive");
    $("passive").checked = passive;
    await refreshPending();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = tab?.url ? parseYouTubeUrl(tab.url) : null;
    if (parsed) {
      $("detected").textContent = `${parsed.kind}: ${parsed.ref}`;
      $("ingest").disabled = false;
      $("ingest").textContent = parsed.kind === "video" ? "Ingest video + its channel" : "Ingest channel";
      $("ingest").onclick = async () => {
        $("ingest").disabled = true;
        const res = await enqueue([{ ...parsed, source_url: tab.url.split("&")[0], mode: "click" }]);
        $("status").textContent = res.ok ? "Queued \u2014 imported by tonight's run" : `Failed (${res.status})`;
        $("ingest").disabled = false;
      };
    }
    $("passive").onchange = (e) => chrome.storage.local.set({ passive: e.target.checked });
    $("sync").onclick = async () => {
      const res = await flushBuffer();
      $("status").textContent = res.ok ? `Synced ${res.sent}` : `Sync failed (${res.status})`;
      await refreshPending();
    };
  }
  init();
})();
