"use strict";
(() => {
  // chrome-extension/src/config.js
  var SUPABASE_URL = "https://mhzwrynnfphlxqcqytrj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oendyeW5uZnBobHhxY3F5dHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyODk5NDAsImV4cCI6MjA1Njg2NTk0MH0.NkZifWOs5IGpQmwbUOYLVRJ2iJskGlh3ggLSuMoxmUk";
  var LOCAL_API = "http://localhost:3210";

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
  async function fetchView(view, params = "") {
    try {
      const res2 = await fetch(`${LOCAL_API}/api/extension/view?name=${view}`);
      if (res2.ok) return res2.json();
    } catch {
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}${params}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    return res.ok ? res.json() : [];
  }

  // chrome-extension/src/popup.js
  var $ = (id) => document.getElementById(id);
  var fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n ?? "\u2013");
  document.querySelectorAll("nav button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab));
    };
  });
  async function renderStats() {
    try {
      const [stats] = await fetchView("ext_stats");
      if (!stats) return;
      $("s-ch").textContent = fmt(stats.channels_tracked);
      $("s-vid").textContent = fmt(stats.videos_est);
      $("s-snap").textContent = fmt(stats.snapshots_today);
      $("s-q").textContent = stats.queue_pending;
      $("s-done").textContent = stats.processed_today;
      $("quota").textContent = `API ${stats.quota_today.toLocaleString()}/${stats.quota_limit.toLocaleString()} \xB7 discovery ${stats.discovery_today}/${stats.discovery_cap}`;
      $("s-cost").textContent = `quota ${Math.round(stats.quota_today / stats.quota_limit * 100)}% used`;
    } catch {
    }
  }
  async function renderChart() {
    try {
      const days = await fetchView("ext_growth");
      const max = Math.max(...days.map((d) => d.videos_added), 1);
      $("chart").innerHTML = days.map((d) => `<div style="height:${Math.max(4, d.videos_added / max * 100)}%" title="${d.day}: ${d.videos_added.toLocaleString()}"></div>`).join("");
    } catch {
    }
  }
  async function renderCandidates() {
    try {
      const rows = await fetchView("ext_candidates");
      document.getElementById("cands").innerHTML = rows.map((r) => `<div>${dot(r.status === "enrolled" ? "ok" : "idle")}<span class="nm">${r.channel_title}</span> <span class="meta">${(r.subscriber_count / 1e3).toFixed(0)}K subs \xB7 seen ${r.seen_count}\xD7 \xB7 ${r.status}</span></div>`).join("") || '<div style="color:#777">none yet \u2014 browse YouTube with passive logging on</div>';
    } catch {
    }
  }
  async function renderQueue() {
    try {
      const rows = await fetchView("ext_recent");
      $("queue").innerHTML = rows.map((r) => {
        const label = (r.result || "").startsWith("already") ? "known" : r.done ? "in" : "importing soon";
        return `<div>${dot(r.done ? "ok" : "warn")}<span class="nm">${r.display_name}</span> <span class="meta">${r.mode} \xB7 ${label}</span></div>`;
      }).join("") || '<div style="color:#777">empty</div>';
    } catch {
      $("queue").textContent = "queue unavailable";
    }
  }
  function dot(state) {
    return `<span class="dot ${state}"></span>`;
  }
  function hrow(k, v, sub = "") {
    return `<div class="hrow"><span class="k">${k}</span><span class="v">${v}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
  }
  async function renderHealth() {
    const manifestVer = chrome.runtime.getManifest().version;
    $("ver").textContent = `v${manifestVer}`;
    const rows = [];
    let hint = "";
    const tab = await findYouTubeTab();
    if (!tab) {
      rows.push(hrow("content script", `${dot("idle")}no YouTube tab open`));
    } else {
      try {
        const pong = await chrome.tabs.sendMessage(tab.id, { type: "ci-ping" });
        const stale = pong.version !== manifestVer;
        rows.push(
          hrow(
            "content script",
            `${dot(stale ? "warn" : pong.observing ? "ok" : "warn")}v${pong.version}${stale ? " (stale)" : ""}`,
            `${pong.badgesPainted} badges \xB7 ${pong.idsKnown} ids known \xB7 passive ${pong.observing ? "on" : "off"}`
          )
        );
        if (stale) hint = "Old bundle still running \u2014 refresh the YouTube tab.";
        const ll = pong.lastLookup;
        rows.push(
          ll ? hrow(
            "last lookup",
            `${dot(ll.ok ? "ok" : "bad")}${ll.ok ? "ok" : ll.error || `HTTP ${ll.status}`}`,
            `${ll.asked} ids \xB7 ${Math.round((Date.now() - ll.at) / 1e3)}s ago`
          ) : hrow("last lookup", `${dot("idle")}none yet`)
        );
      } catch {
        rows.push(hrow("content script", `${dot("bad")}not responding`));
        hint = "Content script not loaded \u2014 reload the extension in chrome://extensions, then refresh the YouTube tab.";
      }
    }
    try {
      const t0 = performance.now();
      const res = await fetch(`${LOCAL_API}/api/extension/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] })
      });
      rows.push(
        hrow(
          "local app",
          `${dot(res.ok ? "ok" : "bad")}${res.ok ? "up" : `HTTP ${res.status}`}`,
          `${LOCAL_API} \xB7 ${Math.round(performance.now() - t0)}ms`
        )
      );
    } catch {
      rows.push(hrow("local app", `${dot("bad")}down`, `${LOCAL_API} \u2014 start the dev server for live badges`));
    }
    const { pending = [], lastSync, trackedCache = [] } = await chrome.storage.local.get([
      "pending",
      "lastSync",
      "trackedCache"
    ]);
    rows.push(
      hrow(
        "capture buffer",
        `${dot(pending.length > 100 ? "warn" : "ok")}${pending.length} pending`,
        lastSync ? `last flush ${Math.round((Date.now() - lastSync) / 6e4)}m ago` : "never flushed"
      )
    );
    rows.push(hrow("tracked cache", `${trackedCache.length} ids`));
    $("health").innerHTML = rows.join("");
    $("health-hint").textContent = hint;
  }
  async function findYouTubeTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.url && parseYouTubeUrl(active.url)) return active;
    const ytTabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    return ytTabs.find((t) => t.active && parseYouTubeUrl(t.url)) || ytTabs.find((t) => parseYouTubeUrl(t.url)) || null;
  }
  async function init() {
    const { passive = true } = await chrome.storage.local.get("passive");
    $("passive").checked = passive;
    const tab = await findYouTubeTab();
    const parsed = tab?.url ? parseYouTubeUrl(tab.url) : null;
    if (parsed) {
      $("no-page").hidden = true;
      $("detected").hidden = false;
      $("ingest").hidden = false;
      $("detected").textContent = `${parsed.kind}: ${parsed.ref}`;
      $("ingest").textContent = parsed.kind === "video" ? "Ingest video + its channel" : "Ingest channel";
      $("ingest").onclick = async () => {
        $("ingest").disabled = true;
        const res = await enqueue([{ ...parsed, source_url: tab.url.split("&")[0], mode: "click" }]);
        $("status").textContent = res.ok ? "Queued \u2014 ingests within ~5 min" : `Failed (${res.status})`;
        $("ingest").disabled = false;
        renderQueue();
      };
    }
    $("passive").onchange = (e) => chrome.storage.local.set({ passive: e.target.checked });
    $("sync").onclick = async (e) => {
      e.preventDefault();
      const res = await flushBuffer();
      $("status").textContent = res.ok ? `Synced ${res.sent}` : `Sync failed (${res.status})`;
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
  setInterval(() => {
    renderQueue();
    renderStats();
    renderCandidates();
    renderHealth();
  }, 7e3);
})();
