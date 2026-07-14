// content_script.js — v0.4.16 (onboarding tour, copy-to-clipboard, tooltip hover fix)
(function () {
  const SCAN_DEBOUNCE_MS = 600;
  let lastScan = 0;
  let seeded = false;
  let cachedList = null;
  let cachedWhitelist = [];
  let bannerDismissedThisLoad = false;
  let lastUrl = location.href;

  const FALLBACK_BANNER =
    'Heads up from "Your Boycott List": This page references companies with documented ties to Trump administration officials (click Details for sources or to suggest an alternative).';

  // -------------- small utils --------------
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escapeHtml = (s) =>
    s ? s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) : "";
  const waitForDocument = () =>
    new Promise((r) => {
      if (document.readyState === "complete" || document.readyState === "interactive") r();
      else document.addEventListener("DOMContentLoaded", () => r(), { once: true });
    });

  // Guard: returns false if Chrome extension APIs are not available in this context
  function chromeReady() {
    try { return !!(chrome && chrome.storage && chrome.storage.local && chrome.runtime && chrome.runtime.sendMessage); }
    catch { return false; }
  }

  function injectBaseStyles() {
    if (document.getElementById("ybl-style")) return;
    const s = document.createElement("style");
    s.id = "ybl-style";
    s.textContent = `
      mark.ybl-match{background:#fff0a6;padding:0 .1em;border-radius:3px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)}
      .ybl-inline{display:inline-block;background:#fff3cd;border:1px solid #f0c36d;border-radius:10px;padding:0 6px;margin-left:6px;font:600 12px/20px system-ui,Arial}

      .ybl-badge{position:absolute;top:6px;right:6px;background:#f5a623;color:#1a1a1a;
        border:2px solid #d4891a;border-radius:20px;
        font:700 13px/1 system-ui,Arial;height:34px;min-width:168px;
        text-align:center;padding:0 12px;line-height:32px;
        z-index:2147483000;box-shadow:0 3px 10px rgba(0,0,0,.18);cursor:pointer;
        animation:ybl-badge-pulse 1.8s ease-in-out 3}
      .ybl-badge::before{content:"\\26D4 ";}
      @keyframes ybl-badge-pulse{
        0%,100%{transform:scale(1);box-shadow:0 3px 10px rgba(0,0,0,.18)}
        50%{transform:scale(1.05);box-shadow:0 4px 18px rgba(245,166,35,.55),0 0 0 3px rgba(245,166,35,.2)}
      }

      /* Tooltip: pointer-events auto so copy button inside is clickable.
         JS controls show/hide — the old CSS :hover rule is intentionally removed. */
      .ybl-tooltip{position:absolute;top:42px;left:6px;max-width:300px;min-width:200px;
        background:#fff;color:#111;border:1px solid #e0e0e0;border-radius:10px;
        box-shadow:0 10px 24px rgba(0,0,0,.16);padding:10px 14px;
        font:400 13px/1.4 system-ui,Arial;z-index:2147483001;display:none;pointer-events:auto}

      .ybl-copy-btn{border:1px solid #d0d0d0;background:#f9f9f9;border-radius:5px;
        padding:3px 6px;cursor:pointer;font-size:12px;flex-shrink:0;line-height:1;
        transition:background .15s;vertical-align:middle}
      .ybl-copy-btn:hover{background:#f0f0f0}

      .ybl-ribbon{position:absolute;left:-6px;top:10px;z-index:2147483000;width:120px;height:0}
      .ybl-ribbon span{position:absolute;display:block;left:0;top:0;background:#dc3545;color:#fff;font:700 11px/20px system-ui,Arial;text-align:center;
        transform:rotate(-45deg);transform-origin:0 0;width:160px;box-shadow:0 6px 16px rgba(0,0,0,.22);padding:1px 0}
      .ybl-ribbon span::before,.ybl-ribbon span::after{content:"";position:absolute;bottom:-6px;border-top:6px solid #99232d;border-left:6px solid transparent;border-right:6px solid transparent}
      .ybl-ribbon span::before{left:0}.ybl-ribbon span::after{right:0}

      /* ensure Amazon tiles are positioning contexts */
      [data-component-type="s-search-result"][data-asin]{position:relative!important}

      /* ---------- Onboarding tour ---------- */
      #ybl-tour-panel{position:fixed;bottom:24px;right:24px;width:300px;
        background:#fff;border:2px solid #f5a623;border-radius:12px;
        box-shadow:0 8px 32px rgba(0,0,0,.24),0 0 0 4px rgba(245,166,35,.1);
        padding:16px;font-family:system-ui,Arial,sans-serif;
        z-index:2147483646;animation:ybl-tour-slide .3s ease-out}
      @keyframes ybl-tour-slide{
        from{transform:translateX(calc(100% + 24px));opacity:0}
        to{transform:translateX(0);opacity:1}
      }
      .ybl-tour-ring{
        outline:3px solid #f5a623!important;outline-offset:4px!important;
        border-radius:6px!important;animation:ybl-ring-pulse 1.5s ease-in-out infinite!important;
        position:relative!important;z-index:2147483000!important}
      @keyframes ybl-ring-pulse{
        0%,100%{box-shadow:0 0 0 3px rgba(245,166,35,.4)}
        50%{box-shadow:0 0 0 8px rgba(245,166,35,.15)}
      }
    `;
    document.head.appendChild(s);
  }

  // -------------- data --------------
  async function getListAndWhitelist() {
    if (!chromeReady()) return { list: cachedList || [], whitelist: cachedWhitelist || [] };
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
      try {
        chrome.storage.local.get(["boycottList", "whitelist"], (items) => {
          cachedList = (items && items.boycottList) || [];
          cachedWhitelist = (items && items.whitelist) || [];
          res({ list: cachedList, whitelist: cachedWhitelist });
        });
      } catch {
        res({ list: cachedList || [], whitelist: cachedWhitelist || [] });
      }
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
    // Copy button click delegation
    tip.addEventListener("click", (e) => {
      const btn = e.target.closest(".ybl-copy-btn");
      if (!btn) return;
      e.stopPropagation();
      const text = btn.dataset.copy;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = "✓";
        btn.style.color = "#16a34a";
        setTimeout(() => { btn.innerHTML = orig; btn.style.color = ""; }, 1500);
      }).catch(() => {});
    });
    return tip;
  }

  function buildTooltipHtml(matchedItem, matchedTerm) {
    let html = `<div><strong>${escapeHtml(matchedItem.name || "")}</strong></div>`;
    if (matchedItem.explanation) html += `<div style="margin-top:4px;color:#333">${escapeHtml(matchedItem.explanation)}</div>`;
    if (matchedItem.alternative) {
      const altEsc = escapeHtml(matchedItem.alternative);
      html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee">
        <div style="font-weight:700;margin-bottom:4px">Try instead:</div>
        <div style="display:flex;align-items:flex-start;gap:6px">
          <span style="flex:1;line-height:1.4">${altEsc}</span>
          <button class="ybl-copy-btn" data-copy="${altEsc}" title="Copy to clipboard">📋</button>
        </div>
      </div>`;
    }
    if (matchedItem.source && matchedItem.source.name) {
      const url = matchedItem.source.url || "#";
      html += `<div style="margin-top:6px;font-size:12px;color:#555">Source: <a href="${url}" target="_blank" rel="noopener">${escapeHtml(matchedItem.source.name)}</a></div>`;
    }
    html += `<div style="margin-top:6px;font-size:12px;color:#777">Click for full details.</div>`;
    return html;
  }

  function makeBadge(text, tooltipHtml) {
    const f = document.createDocumentFragment();
    const b = document.createElement("div");
    b.className = "ybl-badge";
    b.textContent = text || "On your Boycott List";
    f.appendChild(b);
    if (tooltipHtml) {
      const tip = makeTooltip(tooltipHtml);
      f.appendChild(tip);
      // JS-controlled hover so users can move mouse into tooltip to click copy button
      let hideTimer = null;
      const show = () => { clearTimeout(hideTimer); tip.style.display = "block"; };
      const hide = () => { hideTimer = setTimeout(() => { tip.style.display = "none"; }, 200); };
      b.addEventListener("mouseenter", show);
      b.addEventListener("mouseleave", hide);
      tip.addEventListener("mouseenter", show);
      tip.addEventListener("mouseleave", hide);
    }
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

  // -------------- Shadow-DOM banner --------------
  function showBanner(matchInfo, context = {}) {
    if (bannerDismissedThisLoad) return;

    const old = document.getElementById("ybl-banner-host");
    if (old) old.remove();

    const host = document.createElement("div");
    host.id = "ybl-banner-host";
    host.style.cssText = "position:fixed;inset:0 auto auto 0;z-index:2147483646;width:100%";
    document.documentElement.prepend(host);

    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .banner{position:fixed;top:0;left:0;right:0;background:#fff3cd;border-bottom:1px solid #f0c36d;
        box-shadow:0 2px 10px rgba(0,0,0,.12);font-family:system-ui,Arial,sans-serif;display:flex;align-items:center;
        justify-content:space-between;padding:10px 14px;transition:transform .18s ease}
      .left{display:flex;align-items:center}
      .accent{width:6px;height:28px;background:#f0c36d;border-radius:3px;margin-right:10px;flex-shrink:0}
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
    copy.textContent = `${what}${matchInfo.tie_statement || FALLBACK_BANNER}`;

    wrap.append(title, copy);
    left.append(accent, wrap);

    const right = document.createElement("div");
    const mkBtn = (label, onclick, title) => {
      const b = document.createElement("button");
      b.className = "btn"; b.textContent = label;
      if (title) b.title = title;
      b.onclick = onclick;
      return b;
    };

    const dismiss = mkBtn("Dismiss", () => { bannerDismissedThisLoad = true; host.remove(); }, "Hide until page refresh");
    const whitelist = mkBtn("Whitelist", () => {
      if (!chromeReady()) return;
      chrome.runtime.sendMessage(
        { type: "addWhitelist", item: { id: matchInfo.id, label: matchInfo.name || matchInfo.label } },
        (resp) => { if (resp && resp.ok) host.remove(); else showDonatePrompt(); }
      );
    });
    const details = mkBtn("Details", () => showDetailsModal(matchInfo, context));
    const gear = mkBtn("⚙️", () => { if (chromeReady()) chrome.runtime.sendMessage({ type: "openAdmin" }); }, "Open Admin");

    right.append(dismiss, whitelist, details, gear);
    banner.append(left, right);
    root.appendChild(banner);

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
        <button id="ybl-i-donated" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">I donated</button>
        <button id="ybl-close" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">Close</button>
      </div>
    `;
    document.body.appendChild(m);

    if (chromeReady()) {
      chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
        const d = (resp && resp.ok && resp.config && resp.config.donations) || {};
        const container = m.querySelector("#ybl-donate-btns");
        ["5", "20", "50", "100", "custom"].forEach((a) => {
          const b = document.createElement("a");
          b.href = d[a] || "#"; b.target = "_blank"; b.rel = "noopener noreferrer";
          b.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer;text-decoration:none;color:inherit";
          b.textContent = a === "custom" ? "Custom" : "$" + a;
          container.appendChild(b);
        });
      });
    }

    m.querySelector("#ybl-i-donated").onclick = () => {
      if (chromeReady()) chrome.runtime.sendMessage({ type: "setSupporter", value: true }, () => { alert("Thanks! Features unlocked."); m.remove(); });
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
    Object.assign(card.style, { width: "min(560px,92vw)", background: "#fff", borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", padding: "16px 18px", fontFamily: "system-ui,Arial" });

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:800;font-size:16px;margin-bottom:8px";
    titleEl.textContent = info.name || info.label || "Details";

    const body = document.createElement("div");
    body.style.cssText = "font-size:14px;line-height:1.45";

    const tie = info.tie_statement || 'This page references companies with documented ties to Trump administration officials.';
    const src = info.source || {};
    const sourceBlock = (src.name || src.url) ? `<div style="margin-top:8px">Source: <a href="${src.url || "#"}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.name || "Source")}</a></div>` : "";
    const alt = (info.alternative || "").trim();
    const altBlock = alt
      ? `<div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
           <div style="display:flex;align-items:flex-start;gap:8px">
             <div style="flex:1"><strong>Try instead:</strong> ${escapeHtml(alt)}</div>
             <button id="ybl-copy-alt" data-copy="${escapeHtml(alt)}" title="Copy to clipboard"
               style="border:1px solid #b0b0b0;background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;flex-shrink:0;white-space:nowrap">📋 Copy</button>
           </div>
         </div>`
      : `<div style="margin-top:8px"><button id="ybl-suggest-alt" style="padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer">Suggest an alternative</button></div>`;

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
      <div>${escapeHtml(info.explanation || "")}</div>
      ${sourceBlock}
      <div style="margin-top:10px"><strong>Where it matched:</strong><ul style="margin:6px 0 0 16px;padding:0">${list}</ul></div>
      ${altBlock}
      ${donate}
    `;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;margin-top:12px";
    const adminBtn = document.createElement("button");
    adminBtn.textContent = "Open Admin";
    adminBtn.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer";
    adminBtn.onclick = () => { if (chromeReady()) chrome.runtime.sendMessage({ type: "openAdmin" }); };
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer";
    ok.onclick = () => modal.remove();
    row.append(adminBtn, ok);

    card.append(titleEl, body, row);
    modal.appendChild(card);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    const suggestBtn = card.querySelector("#ybl-suggest-alt");
    if (suggestBtn) suggestBtn.addEventListener("click", () => { if (chromeReady()) chrome.runtime.sendMessage({ type: "openAdmin" }); });

    // Wire copy-alternative button
    const copyAltBtn = card.querySelector("#ybl-copy-alt");
    if (copyAltBtn) {
      copyAltBtn.addEventListener("click", () => {
        const text = copyAltBtn.dataset.copy;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          copyAltBtn.innerHTML = "✓ Copied!";
          copyAltBtn.style.background = "#dcfce7";
          copyAltBtn.style.borderColor = "#86efac";
          setTimeout(() => {
            copyAltBtn.innerHTML = "📋 Copy";
            copyAltBtn.style.background = "#fff";
            copyAltBtn.style.borderColor = "#b0b0b0";
          }, 2000);
        }).catch(() => {});
      });
    }

    if (chromeReady()) {
      chrome.runtime.sendMessage({ type: "getConfig" }, (resp) => {
        const d = (resp && resp.ok && resp.config && resp.config.donations) || {};
        const drow = document.getElementById("ybl-donate-row");
        if (!drow) return;
        const mk = (label, key) => {
          const a = document.createElement("a"); a.textContent = label; a.href = d[key] || "#"; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.style.cssText = "padding:6px 10px;border:1px solid #b0b0b0;background:#fff;border-radius:6px;cursor:pointer;text-decoration:none;color:inherit"; return a;
        };
        drow.append(mk("$5","5"), mk("$20","20"), mk("$50","50"), mk("$100","100"), mk("Custom","custom"));
      });
    }
  }

  // -------------- Amazon search-result tiles --------------
  function enhanceAmazonTiles(terms, hits) {
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
      if (!tile || tile.dataset.yblTagged === "1") return;
      tile.dataset.yblTagged = "1";

      const titleEl = tile.querySelector("h2 a span, h2 a, h2 span");
      const titleText = (titleEl?.textContent || "").trim();
      if (!titleText) return;

      let matchedTerm = null, matchedItem = null;
      for (const { t, re } of regxes) {
        if (re.test(titleText)) { matchedTerm = t; matchedItem = termMap[t.toLowerCase()] || null; break; }
      }
      if (!matchedTerm) return;

      const name = matchedItem?.name || "On your Boycott List";
      const tooltipHtml = buildTooltipHtml(matchedItem || { name }, matchedTerm);

      tile.style.setProperty("position", "relative", "important");
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

    const tiles = $$(`[data-component-type="s-search-result"][data-asin]`, resultsRoot);
    tiles.forEach(tagTile);

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

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) tagTile(e.target); });
    }, { root: null, threshold: 0.05 });
    $$('[data-component-type="s-search-result"][data-asin]', resultsRoot).forEach((tile) => io.observe(tile));
  }

  // -------------- Amazon detail page chip + recommendation carousels --------------
  function enhanceAmazonDetail(terms, hits) {
    if (!/amazon\./i.test(location.hostname)) return;
    if (!terms || !terms.length || !hits || !hits.length) return;

    const termMap = {};
    (hits || []).forEach((h) => h.terms.forEach((t) => { const k = t.toLowerCase(); if (!termMap[k]) termMap[k] = h.item; }));
    const regxes = terms.map((t) => ({ t, re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }));

    const findMatch = (text) => {
      if (!text) return null;
      for (const { t, re } of regxes) {
        if (re.test(text)) return { term: t, item: termMap[t.toLowerCase()] || hits[0]?.item };
      }
      return null;
    };

    // DETAIL PAGE: inject chip below product title on /dp/ pages
    if (/\/dp\//i.test(location.pathname) && !document.getElementById("ybl-detail-chip")) {
      const titleEl = document.querySelector("#productTitle") || document.querySelector("#title h1") || document.querySelector("#title");
      if (titleEl) {
        const bylineEl = document.querySelector("#bylineInfo") || document.querySelector(".po-brand td.a-span9");
        const match =
          findMatch(titleEl.innerText) ||
          findMatch(bylineEl?.innerText) ||
          { term: hits[0].terms[0] || "", item: hits[0].item };

        if (match && match.item) {
          const wrapper = document.createElement("div");
          wrapper.id = "ybl-detail-chip";
          wrapper.style.cssText = "position:relative;display:inline-block;margin:8px 0 4px";

          const chip = document.createElement("div");
          chip.style.cssText = [
            "display:inline-block",
            "background:#f5a623",
            "color:#1a1a1a",
            "border:2px solid #d4891a",
            "border-radius:20px",
            "padding:0 14px",
            "height:34px",
            "line-height:32px",
            "font:700 13px/32px system-ui,Arial",
            "cursor:pointer",
            "box-shadow:0 3px 10px rgba(0,0,0,.18)",
            "animation:ybl-badge-pulse 1.8s ease-in-out 3",
          ].join(";");
          chip.innerHTML = "&#x26D4; On your Boycott List";
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            showDetailsModal(match.item, { hits: [{ label: match.item.name, terms: [match.term], count: 1 }] });
          });

          const tip = document.createElement("div");
          tip.style.cssText = "display:none;position:absolute;top:40px;left:0;background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:10px 14px;font:400 13px/1.4 system-ui,Arial;box-shadow:0 8px 20px rgba(0,0,0,.14);z-index:2147483001;max-width:300px;min-width:200px;pointer-events:auto";
          tip.innerHTML = buildTooltipHtml(match.item, match.term);

          // Copy button delegation for detail chip tooltip
          tip.addEventListener("click", (e) => {
            const btn = e.target.closest(".ybl-copy-btn");
            if (!btn) return;
            e.stopPropagation();
            const text = btn.dataset.copy;
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
              const orig = btn.innerHTML;
              btn.innerHTML = "✓";
              btn.style.color = "#16a34a";
              setTimeout(() => { btn.innerHTML = orig; btn.style.color = ""; }, 1500);
            }).catch(() => {});
          });

          let chipHideTimer = null;
          const showTip = () => { clearTimeout(chipHideTimer); tip.style.display = "block"; };
          const hideTip = () => { chipHideTimer = setTimeout(() => { tip.style.display = "none"; }, 200); };
          chip.addEventListener("mouseenter", showTip);
          chip.addEventListener("mouseleave", hideTip);
          tip.addEventListener("mouseenter", showTip);
          tip.addEventListener("mouseleave", hideTip);

          wrapper.append(chip, tip);
          titleEl.parentNode.insertBefore(wrapper, titleEl.nextSibling);
        }
      }
    }

    // RECOMMENDATION CAROUSELS: tag [data-asin] cards not already handled
    const recSelectors = [
      ".a-carousel-card[data-asin]",
      "li[data-asin]:not([data-component-type='s-search-result'])",
      "[data-component-type='s-impression-logger'][data-asin]",
      "[data-asin].p13n-sc-uncoverable-faceout",
      "[data-asin].octopus-pc-item",
    ];

    const tagRecCard = (card) => {
      if (!card || card.dataset.yblTagged === "1") return;
      const titleEl = card.querySelector(
        ".a-size-base-plus, .a-size-mini, .a-size-small.a-text-normal, a span.a-text-normal, a span, h2 a span"
      );
      if (!titleEl) return;
      const text = titleEl.textContent.trim();
      if (!text) return;
      const match = findMatch(text);
      if (!match || !match.item) return;

      card.dataset.yblTagged = "1";
      card.style.setProperty("position", "relative", "important");
      const tooltipHtml = buildTooltipHtml(match.item, match.term);
      const frag = makeBadge("On your Boycott List", tooltipHtml);
      card.appendChild(frag);

      const badge = card.querySelector(".ybl-badge:last-of-type");
      if (badge) {
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          showDetailsModal(match.item, { hits: [{ label: match.item.name, terms: [match.term], count: 1 }] });
        });
      }
    };

    recSelectors.forEach((sel) => { try { $$(sel).forEach(tagRecCard); } catch {} });

    // Watch for lazily-loaded rec cards
    const recObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          recSelectors.forEach((sel) => {
            if (n.matches?.(sel)) tagRecCard(n);
            n.querySelectorAll?.(sel).forEach(tagRecCard);
          });
        });
      }
    });
    recObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // -------------- Onboarding Tour --------------

  const TOUR_STEPS = [
    {
      // Step 0: Amazon — any non-search, non-detail page (homepage, deals, etc.)
      test: () =>
        /amazon\.(com|ca|co\.uk|de|fr|it|es|com\.au)/i.test(location.hostname) &&
        !/\/dp\//i.test(location.pathname) &&
        !/[?&]k=/i.test(location.href) &&
        !/\/s(\?|\/|$)/i.test(location.pathname),
      title: "Your Boycott List is live! 🎉",
      body: "See the <strong>orange banner</strong> at the top? Amazon is on your boycott list. Click <strong>Details</strong> on the banner to see the evidence and find alternatives.",
      nextLabel: "Next: spot chips on search results →",
      nextUrl: "https://www.amazon.com/s?k=amazon+basics",
      highlightEl: () => document.getElementById("ybl-banner-host"),
    },
    {
      // Step 1: Amazon search results
      test: () =>
        /amazon\.(com|ca|co\.uk|de|fr|it|es|com\.au)/i.test(location.hostname) &&
        (/[?&]k=/i.test(location.href) || /\/s(\?|\/|$)/i.test(location.pathname)),
      title: "Orange chips = flagged products",
      body: "See the <strong>⊘ On your Boycott List</strong> chips on Amazon Basics products? <strong>Hover</strong> over a chip — you'll see an ethical alternative you can copy with one click.",
      nextLabel: "Next: see chip on a product page →",
      nextUrl: "https://www.amazon.com/dp/B00MNV8E0C",
      highlightEl: () => document.querySelector(".ybl-badge"),
    },
    {
      // Step 2: Amazon product detail page
      test: () =>
        /amazon\.(com|ca|co\.uk|de|fr|it|es|com\.au)/i.test(location.hostname) &&
        /\/dp\//i.test(location.pathname),
      title: "Chips on product pages too",
      body: "The chip appears <strong>below the product title</strong> on every flagged product — right where you're reading specs and reviews.<br><br>You're all set! MBL silently monitors 34+ brands as you browse.",
      nextLabel: "✓ Done — start shopping!",
      nextUrl: null,
      highlightEl: () => document.getElementById("ybl-detail-chip"),
    },
  ];

  function getCurrentTourStep() {
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      try { if (TOUR_STEPS[i].test()) return i; } catch {}
    }
    return null;
  }

  function clearTourHighlight() {
    document.querySelectorAll(".ybl-tour-ring").forEach((el) => el.classList.remove("ybl-tour-ring"));
  }

  function highlightTourTarget(stepIndex) {
    clearTourHighlight();
    const stepData = TOUR_STEPS[stepIndex];
    if (!stepData || !stepData.highlightEl) return;
    let attempts = 0;
    const tryHighlight = () => {
      try {
        const el = stepData.highlightEl();
        if (el) {
          el.classList.add("ybl-tour-ring");
        } else if (attempts < 10) {
          attempts++;
          setTimeout(tryHighlight, 400);
        }
      } catch {}
    };
    tryHighlight();
  }

  function dismissTour() {
    if (chromeReady()) {
      try { chrome.storage.session.set({ tourActive: false }); } catch {}
    }
    const panel = document.getElementById("ybl-tour-panel");
    if (panel) panel.remove();
    clearTourHighlight();
  }

  function showTourPanel(stepIndex) {
    const old = document.getElementById("ybl-tour-panel");
    if (old) old.remove();

    const stepData = TOUR_STEPS[stepIndex];
    if (!stepData) return;

    const panel = document.createElement("div");
    panel.id = "ybl-tour-panel";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="background:#f5a623;color:#1a1a1a;font:700 11px/1 system-ui;padding:3px 8px;border-radius:10px;letter-spacing:.3px">
          STEP ${stepIndex + 1} OF ${TOUR_STEPS.length}
        </div>
        <button id="ybl-tour-skip" style="background:none;border:none;cursor:pointer;color:#888;font:400 12px/1 system-ui;padding:0 2px">✕ Skip tour</button>
      </div>
      <div style="font:700 14px/1.3 system-ui,Arial;color:#111;margin-bottom:8px">${stepData.title}</div>
      <div style="font:400 13px/1.5 system-ui,Arial;color:#333;margin-bottom:14px">${stepData.body}</div>
      <button id="ybl-tour-next" style="width:100%;padding:10px 12px;background:#f5a623;border:2px solid #d4891a;border-radius:8px;cursor:pointer;font:700 13px/1 system-ui,Arial;color:#1a1a1a;transition:background .15s">
        ${stepData.nextLabel}
      </button>
    `;

    document.body.appendChild(panel);
    highlightTourTarget(stepIndex);

    const nextBtn = panel.querySelector("#ybl-tour-next");
    nextBtn.addEventListener("mouseenter", () => { nextBtn.style.background = "#e89c1a"; });
    nextBtn.addEventListener("mouseleave", () => { nextBtn.style.background = "#f5a623"; });

    panel.querySelector("#ybl-tour-skip").addEventListener("click", dismissTour);

    nextBtn.addEventListener("click", () => {
      if (stepData.nextUrl) {
        window.location.href = stepData.nextUrl;
      } else {
        // Last step — end tour
        dismissTour();
        const done = document.createElement("div");
        done.style.cssText = "position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;padding:12px 20px;border-radius:10px;font:700 14px/1.4 system-ui,Arial;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,.2);animation:ybl-tour-slide .3s ease-out";
        done.textContent = "✓ Tour complete! Happy (ethical) shopping.";
        document.body.appendChild(done);
        setTimeout(() => done.remove(), 3500);
      }
    });
  }

  async function setupOnboarding() {
    if (!chromeReady()) return;
    let tourActive = false;
    try {
      const result = await new Promise((res, rej) => {
        chrome.storage.session.get("tourActive", (data) => {
          if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
          else res(data);
        });
      });
      tourActive = !!result.tourActive;
    } catch { return; }
    if (!tourActive) return;
    if (!/amazon\.(com|ca|co\.uk|de|fr|it|es|com\.au)/i.test(location.hostname)) return;

    // Wait for page and MBL scan to settle
    await new Promise((res) => setTimeout(res, 1400));

    const step = getCurrentTourStep();
    if (step === null) return;
    showTourPanel(step);
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
        try { if (chromeReady()) await chrome.runtime.sendMessage({ type: "refreshSeed" }); } catch {}
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

    const uniqueTerms = Array.from(new Set(hits.flatMap((h) => h.terms))).slice(0, 24);

    try { enhanceAmazonTiles(uniqueTerms, hits); } catch {}
    try { enhanceAmazonDetail(uniqueTerms, hits); } catch {}

    showBanner(top.item, { hits });
  }

  // -------------- SPA navigation handler --------------
  function setupSpaNav() {
    // Intercept History API pushState (Amazon, LinkedIn, etc.)
    try {
      const origPush = history.pushState.bind(history);
      history.pushState = (...args) => {
        origPush(...args);
        onUrlChange();
      };
      const origReplace = history.replaceState.bind(history);
      history.replaceState = (...args) => {
        origReplace(...args);
        onUrlChange();
      };
    } catch {}
    window.addEventListener("popstate", onUrlChange);
  }

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    bannerDismissedThisLoad = false;

    // Clear stale detail chip and tour panel
    const oldChip = document.getElementById("ybl-detail-chip");
    if (oldChip) oldChip.remove();
    const oldPanel = document.getElementById("ybl-tour-panel");
    if (oldPanel) oldPanel.remove();
    clearTourHighlight();

    // Clear tagged markers so tiles re-evaluate on new page
    $$("[data-ybl-tagged]").forEach((el) => delete el.dataset.yblTagged);

    // Small delay for DOM to settle after navigation
    setTimeout(() => {
      scanPage(true);
      setupOnboarding();
    }, 400);
  }

  // -------------- boot --------------
  async function init() {
    await waitForDocument();
    if (!document || !document.body) return;

    setupSpaNav();
    scanPage(true);
    setupOnboarding();

    // Rescan on DOM mutations
    const obs = new MutationObserver(() => scanPage(false));
    obs.observe(document, { childList: true, subtree: true });

    if (chromeReady()) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === "blacklistUpdated") scanPage(true);
        if (msg && msg.type === "startTour") {
          if (chromeReady()) {
            try { chrome.storage.session.set({ tourActive: true }); } catch {}
          }
          // Show tour on current page if on Amazon, otherwise navigate there
          if (/amazon\./i.test(location.hostname)) {
            setTimeout(() => {
              const step = getCurrentTourStep();
              if (step !== null) showTourPanel(step);
            }, 500);
          } else {
            window.location.href = "https://www.amazon.com";
          }
        }
      });
    }
  }

  init().catch(() => {});
})();
