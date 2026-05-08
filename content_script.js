// content_script.js — v0.4.14c (badge reliability + shadow-dom banner)
(function () {
  const SCAN_DEBOUNCE_MS = 600;
  let lastScan = 0;
  let seeded = false;
  let cachedList = null;
  let cachedWhitelist = [];
  let bannerDismissedThisLoad = false;

  const FALLBACK_BANNER =
    'Heads up from "Your Boycott List": This page references companies with documented ties to Trump administration officials (details for sources or to suggest an alternative).';

  // -------------- small utils --------------
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escapeHtml = (s) =>
    s ? s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) : "";
  const waitForDocument = () =>
    new Promise((r) => {
      if (document.readyState === "complete" || document.readyState === "interactive") r();
      else document.addEventListener("DOMContentLoaded", () => r(), { once: true });
    });

  function injectBaseStyles() {
    if (document.getElementById("ybl-style")) return;
    const s = document.createElement("style");
    s.id = "ybl-style";
    s.textContent = `
      mark.ybl-match{background:#fff0a6;padding:0 .1em;border-radius:3px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)}
      .ybl-inline{display:inline-block;background:#fff3cd;border:1px solid #f0c36d;border-radius:10px;padding:0 6px;margin-left:6px;font:600 12px/20px system-ui,Arial}
      .ybl-badge{position:absolute;top:8px;right:8px;background:#ffc107;color:#111;border:1px solid #e0a800;border-radius:16px;
        font:700 12px/28px system-ui,Arial;height:28px;min-width:150px;text-align:center;padding:0 10px;z-index:2147483000;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer}
      .ybl-badge::before{content:"\\26D4\\FE0F ";}

      .ybl-tooltip{position:absolute;top:32px;left:8px;max-width:320px;background:#fff;color:#111;border:1px solid #ddd;border-radius:10px;
        box-shadow:0 10px 24px rgba(0,0,0,.18);padding:10px 12px;font:400 12px/1.35 system-ui,Arial;z-index:2147483001;display:none}
      .ybl-badge:hover + .ybl-tooltip{display:block}

      .ybl-ribbon{position:absolute;left:-6px;top:10px;z-index:2147483000;width:120px;height:0}
      .ybl-ribbon span{position:absolute;display:block;left:0;top:0;background:#dc3545;color:#fff;font:700 11px/20px system-ui,Arial;text-align:center;
        transform:rotate(-45deg);transform-origin:0 0;width:160px;box-shadow:0 6px 16px rgba(0,0,0,.22);padding:1px 0}
      .ybl-ribbon span::before,.ybl-ribbon span::after{content:"";position:absolute;bottom:-6px;border-top:6px solid #99232d;border-left:6px solid transparent;border-right:6px solid transparent}
      .ybl-ribbon span::before{left:0}.ybl-ribbon span::after{right:0}

      /* ensure Amazon tiles are positioning contexts */
      [data-component-type="s-search-result"][data-asin]{position:relative!important}
    `;
    document.head.appendChild(s);
  }

  // -------------- data --------------
  async function getListAndWhitelist() {
    try {
      const listResp = await chrome.runtime.sendMessage({ type: "getList" });
      const wlResp = await chrome.runtime.sendMessage({ type: "getWhitelist" });
      const list = (listResp && listResp.list) || [];
      const whitelist = (wlResp && wlResp.whitelist) || [];
      if (Array.isArray(list) && list.length) {
        cachedList = list;
        cachedWhitelist = whitelist;
        return { list, whitelist };
      }
    } catch {}
    return new Promise((res) => {
      chrome.storage.local.get(["boycottList", "whitelist"], (items) => {
        cachedList = items.boycottList || [];
        cachedWhitelist = items.whitelist || [];
        res({ list: cachedList, whitelist: cachedWhitelist });
      });
    });
  }

  // -------------- matching --------------
  function collectMatches(items, haystack) {
    const out = [];
    for (const it of items) {
      if (!it || !it.pattern) continue;
      let count = 0, terms = [];
      try {
        if (it.match_type === "regex") {
          const re = new RegExp(it.pattern, "ig");
          haystack.replace(re, (m) => { count++; terms.push(m); return m; });
        } else {
          const aliases = Array.isArray(it.brand_aliases) ? it.brand_aliases : [];
          const patterns = [it.pattern, ...aliases].filter(Boolean);
          for (const pat of patterns) {
            const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
            haystack.replace(re, (m) => { count++; terms.push(m); return m; });
          }
        }
      } catch {}
      if (count > 0) out.push({ item: it, label: it.name || it.label || "—", count, terms: [...new Set(terms.map(String))] });
    }
    return out;
  }

  // -------------- UI helpers --------------
  function makeTooltip(html) {
    const tip = document.createElement("div");
    tip.className = "ybl-tooltip";
    tip.innerHTML = html;
    return tip;
  }
  function makeBadge(text, tooltipHtml) {
    const f = document.createDocumentFragment();
    const b = document.createElement("div");
    b.className = "ybl-badge";
    b.textContent = text || "On your Boycott List";
    f.appendChild(b);
    if (tooltipHtml) f.appendChild(makeTooltip(tooltipHtml));
    return f;
  }
  function makeRibbon(text) {
    const r = document.createElement("div");
    r.className = "ybl-ribbon";
    const s = document.createElement("span");
    s.textContent = text || "URGENT";
    r.appendChild(s);
    return r;
  }

  // -------------- Shadow-DOM banner (prevents host CSS leaks) --------------
  function showBanner(matchInfo, context = {}) {
    if (bannerDismissedThisLoad) return;

    // nuke existing
    const old = document.getElementById("ybl-banner-host");
    if (old) old.remove();

    // host + shadow
    const host = document.createElement("div");
    host.id = "ybl-banner-host";
    host.style.position = "fixed";
    host.style.inset = "0 auto auto 0";
    host.style.zIndex = "2147483646";
    host.style.width = "100%";
    document.documentElement.prepend(host);

    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .banner{position:fixed;top:0;left:0;right:0;background:#fff3cd;border-bottom:1px solid #f0c36d;
        box-shadow:0 2px 10px rgba(0,0,0,.12);font-family:system-ui, Arial, sans-serif;display:flex;align-items:center;
        justify-content:space-between;padding:10px 14px;transition:transform .18s ease}
      .left{display:flex;align-items:center}
      .accent{width:6px;height:28px;background:#f0c36d;border-radius:3px;margin-right:10px}
      .title{font-weight:800;margin-bottom:2px}
      .btn{margin-left:8px;padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer;font:inherit}
    `;
    root.appendChild(style);

    const banner = document.createElement("div");
    banner.className = "banner";

    const left = document.createElement("div");
    left.className = "left";

    const accent = document.createElement("div");
    accent.className = "accent";

    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = 'Heads up from "Your Boycott List"';

    const matchedTerms = (context.hits?.[0]?.terms || []).slice(0, 3).map(escapeHtml);
    const what = matchedTerms.length ? `Matched: "${matchedTerms.join('", "')}" — ` : "";
    const copy = document.createElement("div");
    const direct = matchInfo.tie_statement || "";
    copy.textContent = `${what}${direct || FALLBACK_BANNER}`;

    wrap.append(title, copy);
    left.append(accent, wrap);

    const right = document.createElement("div");

    const mkBtn = (label, onclick, title) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = label;
      if (title) b.title = title;
      b.onclick = onclick;
      return b;
    };

    const dismiss = mkBtn("Dismiss", () => {
      bannerDismissedThisLoad = true;
      host.remove();
    }, "Hide until page refresh");

    const whitelist = mkBtn("Whitelist", () => {
      chrome.runtime.sendMessage(
        { type: "addWhitelist", item: { id: matchInfo.id, label: matchInfo.name || matchInfo.label } },
        (resp) => {
          if (resp && resp.ok) host.remove();
          else showDonatePrompt(); // supporter gate
        }
      );
    });

    const details = mkBtn("Details", () => showDetailsModal(matchInfo, context));
    const gear = mkBtn("⚙️", () => chrome.runtime.sendMessage({ type: "openAdmin" }), "Open Admin");

    right.append(dismiss, whitelist, details, gear);
    banner.append(left, right);
    root.appendChild(banner);

    // sticky hide/reveal
    let hidden = false;
    window.addEventListener("scroll", () => {
      if (window.scrollY > 80 && !hidden) { banner.style.transform = "translateY(-100%)"; hidden = true; }
      else if (window.scrollY <= 10 && hidden) { banner.style.transform = "translateY(0)"; hidden = false; }
    });
  }

  // -------------- Details & Donate --------------
  function showDonatePrompt() {
    let m = document.getElementById("ybl-donate");
    if (m) m.remove();
    m = document.createElement("div");
    Object.assign(m.style, {
      position: "fixed", bottom: "12px", right: "12px", zIndex: "2147483647",
      background: "#fff", border: "1px solid #ddd", borderRadius: "10px",
      boxShadow: "0 6px 20px rgba(0,0,0,.2)", padding: "12px", fontFamily: "system-ui,Arial"
    });
    m.id = "ybl-donate";
    m.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Unlock whitelist & admin actions</div>
      <div style="margin-bottom:8px">Please donate to support development. After donating, click "I donated" to unlock.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="ybl-donate-btns"></div>
      <div style="margin-top:8px;text-align:right">
        <button class="ybl-btn" id="ybl-i-donated" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">I donated</button>
        <button class="ybl-btn" id="ybl-close" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">Close</button>
      </div>
    `;
    document.body.appendChild(m);

    chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
      const d = (resp && resp.ok && resp.config && resp.config.donations) || { "5": "#", "20": "#", "50": "#", "100": "#", "custom": "#" };
      const container = m.querySelector("#ybl-donate-btns");
      ["5", "20", "50", "100", "custom"].forEach((a) => {
        const link = d[a] || "#";
        const b = document.createElement("a");
        b.href = link; b.target = "_blank"; b.rel = "noopener noreferrer";
        b.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer;text-decoration:none;color:inherit";
        b.textContent = (a === "custom") ? "Custom" : "$" + a;
        container.appendChild(b);
      });
    });

    m.querySelector("#ybl-i-donated").onclick = () => {
      chrome.runtime.sendMessage({ type: "setSupporter", value: true }, () => { alert("Thanks! Features unlocked for this browser."); m.remove(); });
    };
    m.querySelector("#ybl-close").onclick = () => m.remove();
  }

  function showDetailsModal(info, context = {}) {
    let modal = document.getElementById("ybl-modal");
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "ybl-modal";
    Object.assign(modal.style, { position: "fixed", inset: "0", zIndex: "2147483647", background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" });

    const card = document.createElement("div");
    Object.assign(card.style, { width: "min(560px,92vw)", background: "#fff", borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", padding: "16px 18px", fontFamily: "system-ui, Arial" });

    const title = document.createElement("div");
    title.style.fontWeight = "800"; title.style.fontSize = "16px"; title.style.marginBottom = "8px";
    title.textContent = info.name || info.label || "Details";

    const body = document.createElement("div");
    body.style.fontSize = "14px"; body.style.lineHeight = "1.45";

    const defaultTie = 'This page references companies with documented ties to Trump administration officials (details for sources or to suggest an alternative).';
    const tie = info.tie_statement ? info.tie_statement : defaultTie;
    const expl = escapeHtml(info.explanation || info.reason || "");
    const src = info.source || {};
    const sourceBlock = (src.name || src.url) ? `<div style="margin-top:8px">Source: <a href="${src.url || "#"}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.name || "Source")}</a></div>` : "";
    const alt = (info.alternative || "").trim();
    const altBlock = alt ? `<div style="margin-top:8px"><strong>Alternative:</strong> ${escapeHtml(alt)}</div>` : `<div style="margin-top:8px"><button class="ybl-btn" id="ybl-suggest-alt" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">Suggest an alternative</button></div>`;

    const list = (context.hits || []).map((h) => {
      const terms = h.terms?.slice(0, 5).map((t) => `"${escapeHtml(t)}"`).join(", ");
      return `<li style="margin-bottom:6px"><strong>${escapeHtml(h.label)}</strong> — ${h.count || 1} hit(s)${terms ? `<div style="color:#444;margin-top:2px">${terms}</div>` : ""}</li>`;
    }).join("");

    const donate = `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee">
      <div style="font-weight:700;margin-bottom:6px">Support this project</div>
      <div id="ybl-donate-row" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    </div>`;

    body.innerHTML = `
      <div style="margin-bottom:6px"><strong>${escapeHtml(tie)}</strong></div>
      <div>${expl || "No explanation provided."}</div>
      ${sourceBlock}
      <div style="margin-top:10px"><strong>Where it matched:</strong><ul style="margin:6px 0 0 16px;padding:0">${list}</ul></div>
      ${altBlock}
      ${donate}
    `;

    const row = document.createElement("div");
    row.style.display = "flex"; row.style.justifyContent = "space-between"; row.style.marginTop = "12px";
    const adminBtn = document.createElement("button"); adminBtn.textContent = "Open Admin";
    adminBtn.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer";
    adminBtn.onclick = () => chrome.runtime.sendMessage({ type: "openAdmin" });
    const ok = document.createElement("button"); ok.textContent = "OK";
    ok.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer";
    ok.onclick = () => modal.remove();
    row.append(adminBtn, ok);

    card.append(title, body, row);
    modal.appendChild(card);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    const btn = card.querySelector("#ybl-suggest-alt");
    if (btn) btn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openAdmin" }));

    chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
      const d = (resp && resp.ok && resp.config && resp.config.donations) || { "5": "#", "20": "#", "50": "#", "100": "#", "custom": "#" };
      const row = document.getElementById("ybl-donate-row");
      const mk = (label, key) => { const a = document.createElement("a"); a.textContent = label; a.href = d[key] || "#"; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer;text-decoration:none;color:inherit"; return a; };
      row.append(mk("$5","5"), mk("$20","20"), mk("$50","50"), mk("$100","100"), mk("Custom","custom"));
    });
  }

  // -------------- Amazon-focused badge pass --------------
  function enhanceAmazonTiles(terms, hits) {
    console.log("YBL: enhanceAmazonTiles called, terms:", terms, "hits:", hits);
    
    if (!/amazon\./i.test(location.hostname)) return;
    if (!terms || !terms.length) return;

    const resultsRoot =
      document.querySelector('[data-component-type="s-search-results"]') ||
      document.querySelector("#search") ||
      document.querySelector(".s-main-slot");

    if (!resultsRoot) return;

    const termMap = {};
    (hits || []).forEach((h) => h.terms.forEach((t) => { const k = t.toLowerCase(); if (!termMap[k]) termMap[k] = h.item; }));
    const regxes = terms.map((t) => ({ t, re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }));

    const tagTile = (tile) => {
      console.log("YBL: tagTile called with tile:", tile);
      if (!tile || tile.dataset.yblTagged === "1") return;
      tile.dataset.yblTagged = "1";

      const titleEl = tile.querySelector("h2 a span, h2 a, h2 span");
      const titleText = (titleEl?.textContent || "").trim();
      console.log("YBL: Title found:", titleText);
      if (!titleText) return;

      let matchedTerm = null, matchedItem = null;
      for (const { t, re } of regxes) {
        if (re.test(titleText)) { 
          matchedTerm = t; 
          matchedItem = termMap[t.toLowerCase()] || null; 
          console.log("YBL: MATCH! Term:", t, "Item:", matchedItem?.name);
          break; 
        }
      }
      if (!matchedTerm) {
        console.log("YBL: No match for title:", titleText);
        return;
      }

      const name = matchedItem?.name || "On your Boycott List";
      let tooltipHtml = `<div><strong>${escapeHtml(name)}</strong></div>`;
      if (matchedItem?.explanation) tooltipHtml += `<div style='margin-top:4px'>${escapeHtml(matchedItem.explanation)}</div>`;
      if (matchedItem?.source?.name) {
        const url = matchedItem.source.url || "#";
        tooltipHtml += `<div style='margin-top:6px'>Source: <a href='${url}' target='_blank' rel='noopener'>${escapeHtml(matchedItem.source.name)}</a></div>`;
      }
      tooltipHtml += `<div style='margin-top:6px;color:#333'>Click for details.</div>`;

      tile.style.setProperty('position', 'relative', 'important');
      const frag = makeBadge("On your Boycott List", tooltipHtml);
      tile.appendChild(frag);

      const badge = tile.querySelector(".ybl-badge:last-of-type");
      if (badge && matchedItem) {
        badge.addEventListener("click", () => showDetailsModal(matchedItem, {
          hits: [{ label: matchedItem.name, terms: [matchedTerm], count: 1 }],
        }));
      }
      if (matchedItem?.urgent) tile.appendChild(makeRibbon("URGENT"));
    };

    // initial pass
    const tiles = $$(`[data-component-type="s-search-result"][data-asin]`, resultsRoot);
    console.log("YBL: Found", tiles.length, "tiles to process");
    tiles.forEach(tagTile);

    // observe for lazy tiles/updates
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches?.('[data-component-type="s-search-result"][data-asin]')) tagTile(n);
          n.querySelectorAll?.('[data-component-type="s-search-result"][data-asin]').forEach(tagTile);
        });
      }
    });
    mo.observe(resultsRoot, { childList: true, subtree: true });

    // visibility guard: (optional) tag tiles when they enter viewport
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) tagTile(e.target);
      });
    }, { root: null, threshold: 0.05 });

    $$('[data-component-type="s-search-result"][data-asin]', resultsRoot).forEach((tile) => io.observe(tile));
  }

  // -------------- main scan --------------
  function buildHaystack() {
    const text = (() => { try { return document.body ? document.body.innerText : ""; } catch { return ""; } })().slice(0, 200000);
    return [location.href, text].join(" ");
  }

  async function scanPage(force = false) {
    if (bannerDismissedThisLoad) return;
    const now = Date.now();
    if (!force && now - lastScan < SCAN_DEBOUNCE_MS) return;
    lastScan = now;

    if (!cachedList || !cachedList.length) {
      const { list, whitelist } = await getListAndWhitelist();
      cachedList = list || [];
      cachedWhitelist = whitelist || [];
      if (!cachedList.length && !seeded) {
        seeded = true;
        try { await chrome.runtime.sendMessage({ type: "refreshSeed" }); } catch {}
        const retry = await getListAndWhitelist();
        cachedList = retry.list || [];
        cachedWhitelist = retry.whitelist || [];
      }
    }
    if (!cachedList.length) return;

    const candidates = cachedList.filter((it) => !(cachedWhitelist || []).some((w) => w.id === it.id));
    if (!candidates.length) return;

    const haystack = buildHaystack();
    const hits = collectMatches(candidates, haystack);
    if (!hits.length) return;

    hits.sort((a, b) => b.count - a.count);
    const top = hits[0];

    injectBaseStyles();

    // prep terms for UI matching
    const uniqueTerms = Array.from(new Set(hits.flatMap((h) => h.terms))).slice(0, 24);

    // Amazon tiles (reliable, viewport-aware)
    try { enhanceAmazonTiles(uniqueTerms, hits); } catch {}

    // Banner always
    showBanner(top.item, { hits });
  }

  // -------------- boot --------------
  async function init() {
    await waitForDocument();
    if (!document || !document.body) return;
    scanPage(true);

    // rescan on DOM mutations (non-Amazon pages or updated content)
    const obs = new MutationObserver(() => scanPage(false));
    obs.observe(document, { childList: true, subtree: true });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "blacklistUpdated") scanPage(true);
    });
  }

  init().catch(() => {});
})();
