"use strict";
(() => {
  // chrome-extension/src/config.js
  var LOCAL_API = "http://localhost:3210";

  // lib/extension/badge-targets.ts
  function videoIdFromHref(href) {
    const m = href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
    return m ? m[1] : null;
  }
  var HOSTS = "yt-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer";
  function markupFingerprint(root) {
    const a = root.querySelector('a[href*="/watch?v="]');
    if (!a) return "no watch anchors";
    const chain = [];
    let el = a;
    for (let i = 0; i < 8 && el; i++) {
      chain.push(el.tagName.toLowerCase());
      el = el.parentElement;
    }
    const host = a.closest(HOSTS);
    const doc = root.documentElement ? root : null;
    return [
      `chain ${chain.join(">")}`,
      `anchorImg ${!!a.querySelector("img")}`,
      `host ${host ? host.tagName.toLowerCase() : "none"}`,
      `hostImg ${!!host?.querySelector("img")}`,
      `pageImgs ${doc ? doc.images.length : "?"}`
    ].join(" \xB7 ");
  }
  function findBadgeTargets(root) {
    const out = [];
    const seen2 = /* @__PURE__ */ new Set();
    for (const a of root.querySelectorAll('a[href*="/watch?v="]')) {
      const id = videoIdFromHref(a.getAttribute("href") || "");
      if (!id || seen2.has(id)) continue;
      const host = a.closest(HOSTS);
      const img = a.querySelector("img") ?? host?.querySelector("img") ?? null;
      if (!img) continue;
      seen2.add(id);
      out.push({ id, container: img.parentElement || a });
    }
    return out;
  }

  // lib/extension/feed-hint.ts
  var NOISE = /^(\s*(\d+:)?\d+:\d+\s*)+/;
  var PURE_NOISE = /^\s*((\d+:)?\d+:\d+|now playing|live|shorts|new)?\s*$/i;
  function cleanHint(raw) {
    const t = raw.replace(/[✓◉⏳]\s*(tracked|captured|importing)/gi, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
    return PURE_NOISE.test(t) ? "" : t.slice(0, 80);
  }
  function hintForAnchor(a) {
    const own = cleanHint(a.getAttribute("title") || a.getAttribute("aria-label") || "");
    if (own) return own;
    const host = a.closest(
      "yt-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer"
    );
    const titleEl = host?.querySelector(
      "#video-title, .yt-lockup-metadata-view-model-wiz__title, a[title]"
    );
    const fromTitle = cleanHint(
      titleEl?.getAttribute("title") || titleEl?.textContent || ""
    );
    if (fromTitle) return fromTitle;
    return cleanHint(a.textContent || "");
  }

  // lib/extension/badge-states.ts
  function classifyBadge(video, channelKnown2) {
    if (video === "tracked") return { cls: "ci-tracked", text: "\u2713 tracked" };
    if (video === "queued") return { cls: "ci-queued", text: "\u23F3 queued" };
    if (video === "captured") {
      return channelKnown2 === false ? { cls: "ci-newchannel", text: "\u2605 new channel" } : { cls: "ci-captured", text: "\u25C9 new \u2192 queued" };
    }
    return null;
  }
  function normalizeChannelRef(ref) {
    return ref.replace(/^@/, "").toLowerCase();
  }
  function channelRefFromAnchor(a) {
    const host = a.closest(HOSTS) || a.parentElement;
    if (!host) return null;
    for (const link of host.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      const uc = href.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
      if (uc) return uc[1];
      const h = href.match(/\/(@[A-Za-z0-9._-]{3,60})(?:[/?#]|$)/);
      if (h) return h[1];
    }
    return null;
  }

  // chrome-extension/src/content.js
  var EXT_VERSION = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "0";
    }
  })();
  var seen = /* @__PURE__ */ new Set();
  var status = /* @__PURE__ */ new Map();
  var vidChannel = /* @__PURE__ */ new Map();
  var channelKnown = /* @__PURE__ */ new Map();
  var observer = null;
  var timer = null;
  var CSS = `
.ci-badge { position:absolute; top:6px; left:6px; z-index:100; font:600 11px -apple-system,sans-serif;
  padding:2px 7px; border-radius:10px; pointer-events:none; color:#fff; opacity:.92; }
.ci-tracked { background:#2e7d32; }
.ci-queued { background:#b26a00; }
.ci-captured { background:#455a64; animation: ci-pulse 1.2s ease-in-out 2; }
.ci-newchannel { background:#0e7490; animation: ci-pulse 1.2s ease-in-out 2; }
@keyframes ci-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
`;
  function injectCss() {
    if (document.getElementById("ci-style")) return;
    const el = document.createElement("style");
    el.id = "ci-style";
    el.textContent = CSS;
    document.documentElement.appendChild(el);
  }
  function idFromAnchor(a) {
    const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
    return m ? m[1] : null;
  }
  async function loadTrackedCache() {
    const { trackedCache = [] } = await chrome.storage.local.get("trackedCache");
    for (const id of trackedCache) status.set(id, "tracked");
  }
  async function saveTrackedCache() {
    const tracked = [...status.entries()].filter(([, s]) => s === "tracked").map(([id]) => id);
    await chrome.storage.local.set({ trackedCache: tracked.slice(-8e3) });
  }
  var diag = { lastLookup: null };
  async function lookupStatuses(ids) {
    const refs = [...new Set(
      ids.map((id) => vidChannel.get(id)).filter((r) => r && !channelKnown.has(normalizeChannelRef(r)))
    )];
    try {
      const res = await fetch(`${LOCAL_API}/api/extension/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ids.slice(0, 500), channels: refs.slice(0, 100) })
      });
      diag.lastLookup = { at: Date.now(), ok: res.ok, status: res.status, asked: ids.length };
      if (!res.ok) return;
      const { tracked = [], queued = [], captured = [], knownChannels = [] } = await res.json();
      for (const id of tracked) status.set(id, "tracked");
      for (const id of queued) if (!status.has(id)) status.set(id, "queued");
      for (const id of captured) if (!status.has(id)) status.set(id, "captured");
      const knownSet = new Set(knownChannels);
      for (const r of refs) {
        const n = normalizeChannelRef(r);
        channelKnown.set(n, knownSet.has(n));
      }
      if (tracked.length) await saveTrackedCache();
    } catch (e) {
      diag.lastLookup = { at: Date.now(), ok: false, error: String(e?.message || e), asked: ids.length };
    }
  }
  function badge(container, cls, text) {
    const existing = container.querySelector(":scope > .ci-badge");
    if (existing) {
      existing.className = `ci-badge ${cls}`;
      existing.textContent = text;
      return;
    }
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const b = document.createElement("span");
    b.className = `ci-badge ${cls}`;
    b.textContent = text;
    container.appendChild(b);
  }
  function paintBadges() {
    for (const { id, container } of findBadgeTargets(document)) {
      const ref = vidChannel.get(id);
      const chKnown = ref ? channelKnown.get(normalizeChannelRef(ref)) ?? null : null;
      const spec = classifyBadge(status.get(id) ?? null, chKnown);
      if (spec) badge(container, spec.cls, spec.text);
    }
  }
  async function collectIds() {
    const found = [];
    const pageIds = [];
    for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
      const id = idFromAnchor(a);
      if (!id) continue;
      pageIds.push(id);
      if (!vidChannel.has(id)) {
        const ref = channelRefFromAnchor(a);
        if (ref) vidChannel.set(id, ref);
      }
      if (!seen.has(id)) {
        seen.add(id);
        found.push({ id, hint: hintForAnchor(a) || null });
      }
    }
    if (found.length) {
      try {
        chrome.runtime.sendMessage({ type: "feedIds", items: found, page: location.pathname })?.catch?.(() => {
        });
      } catch {
      }
      for (const f of found) if (!status.has(f.id)) status.set(f.id, "captured");
    }
    const unknown = [...new Set(pageIds)].filter((id) => !status.has(id) || status.get(id) === "captured");
    if (unknown.length) await lookupStatuses(unknown);
    paintBadges();
    reportIfBlind();
  }
  function reportIfBlind() {
    if (!status.size) return;
    if (findBadgeTargets(document).length > 0) return;
    if (Date.now() - (diag.lastReport || 0) < 6e4) return;
    diag.lastReport = Date.now();
    fetch(`${LOCAL_API}/api/extension/diag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: EXT_VERSION,
        page: location.pathname + location.search.slice(0, 40),
        idsKnown: status.size,
        fingerprint: markupFingerprint(document)
      })
    }).catch(() => {
    });
  }
  function startObserving() {
    if (observer) return;
    injectCss();
    loadTrackedCache().then(collectIds);
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(collectIds, 1500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function stopObserving() {
    observer?.disconnect();
    observer = null;
    document.querySelectorAll(".ci-badge").forEach((b) => b.remove());
  }
  if (window.__ciVersion !== EXT_VERSION) {
    window.__ciVersion = EXT_VERSION;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "ci-ping") {
        const targets = findBadgeTargets(document);
        sendResponse({
          version: EXT_VERSION,
          observing: !!observer,
          badgesPainted: document.querySelectorAll(".ci-badge").length,
          idsKnown: status.size,
          targetsFound: targets.length,
          fingerprint: targets.length === 0 ? markupFingerprint(document) : null,
          lastLookup: diag.lastLookup
        });
      }
    });
    chrome.storage.local.get("passive").then(({ passive = true }) => {
      if (passive) startObserving();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "passive" in changes) {
        changes.passive.newValue ? startObserving() : stopObserving();
      }
    });
  }
})();
