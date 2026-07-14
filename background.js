// background.js — Service Worker for Your Boycott List
// DRE-26: Supabase fetch with local fallback
// DRE-19: Correct case path "Data/boycottlist.json" for Linux compatibility

const ALARM_NAME = "ybl-refresh";

// ── Config ────────────────────────────────────────────────────────────────────

let _config = null;

async function getConfig() {
  if (_config) return _config;
  const url = chrome.runtime.getURL("config.json");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Failed to load config.json");
  _config = await resp.json();
  return _config;
}

// ── Supabase fetch ────────────────────────────────────────────────────────────

async function fetchFromSupabase(cfg) {
  // Nested select: pull brand_aliases and brand_sources alongside each brand.
  // Filter to active only so pending_review/inactive never reach users.
  const endpoint = [
    cfg.supabase_url,
    "/rest/v1/brands",
    "?select=id,name,pattern,match_type,tie_statement,explanation,alternative,category,urgent",
    ",brand_aliases(alias)",
    ",brand_sources(name,url)",
    "&status=eq.active",
    "&order=name",
  ].join("");

  const resp = await fetch(endpoint, {
    headers: {
      apikey: cfg.supabase_anon_key,
      Authorization: `Bearer ${cfg.supabase_anon_key}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`Supabase responded ${resp.status}: ${await resp.text()}`);
  }

  const rows = await resp.json();

  // Transform PostgREST nested arrays into the shape content_script.js expects:
  //   brand_aliases: [{alias: "Tesla Motors"}, …]  →  ["Tesla Motors", …]
  //   brand_sources: [{name: "CNN", url: "…"}, …]  →  {name: "CNN", url: "…"} (first source)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    match_type: row.match_type,
    tie_statement: row.tie_statement,
    explanation: row.explanation,
    alternative: row.alternative,
    category: row.category,
    urgent: row.urgent,
    brand_aliases: (row.brand_aliases || []).map((a) => a.alias),
    source: row.brand_sources && row.brand_sources.length > 0
      ? { name: row.brand_sources[0].name, url: row.brand_sources[0].url }
      : {},
  }));
}

// ── Local fallback ────────────────────────────────────────────────────────────

async function fetchFallback() {
  // DRE-19: capital "D" in "Data/" — required on Linux where Chrome's
  // extension filesystem is case-sensitive. "data/boycottlist.json" 404s.
  const url = chrome.runtime.getURL("Data/boycottlist.json");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fallback fetch failed (${resp.status})`);
  const data = await resp.json();
  // Fallback JSON already uses the correct shape; return as-is.
  return Array.isArray(data) ? data : [];
}

// ── Refresh orchestration ─────────────────────────────────────────────────────

async function refreshList() {
  let brands;
  try {
    const cfg = await getConfig();
    brands = await fetchFromSupabase(cfg);
    console.log(`[YBL] Fetched ${brands.length} active brand(s) from Supabase`);
  } catch (err) {
    console.warn("[YBL] Supabase unavailable, using local fallback:", err.message);
    try {
      brands = await fetchFallback();
      console.log(`[YBL] Loaded ${brands.length} brand(s) from fallback`);
    } catch (fallbackErr) {
      console.error("[YBL] Fallback also failed:", fallbackErr.message);
      return;
    }
  }

  await chrome.storage.local.set({
    boycottList: brands,
    lastRefreshed: Date.now(),
  });

  // Notify any open tabs that the list has updated so they re-scan.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "blacklistUpdated" });
    } catch {
      // Tab may not have the content script injected — safe to ignore.
    }
  }
}

// ── Alarm setup ───────────────────────────────────────────────────────────────

async function setupRefreshAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) return; // already scheduled
  const cfg = await getConfig().catch(() => ({ refresh_hours: 24 }));
  const periodInMinutes = (cfg.refresh_hours || 24) * 60;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

// ── Tour helpers ──────────────────────────────────────────────────────────────

async function startOnboardingTour() {
  // Mark tour as active in session storage (cleared on browser restart)
  await chrome.storage.session.set({ tourActive: true });
  // Open amazon.com — step 1 of the tour will display there
  chrome.tabs.create({ url: "https://www.amazon.com" });
}

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  refreshList();
  setupRefreshAlarm();
  // Auto-launch onboarding tour on first install only
  if (reason === "install") {
    startOnboardingTour().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  refreshList();
  setupRefreshAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshList();
});

// ── Message handler ───────────────────────────────────────────────────────────
// All messages from content_script.js and admin.js are handled here.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "getList":
      chrome.storage.local.get(["boycottList"], (items) =>
        sendResponse({ list: items.boycottList || [] })
      );
      return true; // keeps the channel open for async sendResponse

    case "getWhitelist":
      chrome.storage.local.get(["whitelist"], (items) =>
        sendResponse({ whitelist: items.whitelist || [] })
      );
      return true;

    case "addWhitelist":
      chrome.storage.local.get(["whitelist"], (items) => {
        const wl = items.whitelist || [];
        const item = msg.item;
        if (item && !wl.some((w) => w.id === item.id)) {
          wl.push(item);
        }
        chrome.storage.local.set({ whitelist: wl }, () =>
          sendResponse({ ok: true })
        );
      });
      return true;

    case "refreshSeed":
      refreshList().then(() => sendResponse({ ok: true }));
      return true;

    case "openAdmin":
      chrome.tabs.create({ url: chrome.runtime.getURL("admin.html") });
      sendResponse({ ok: true });
      break;

    case "setSupporter":
      chrome.storage.local.set({ supporter: !!msg.value }, () =>
        sendResponse({ ok: true })
      );
      return true;

    case "getConfig":
      getConfig()
        .then((cfg) => sendResponse({ ok: true, config: cfg }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case "startTour":
      // Called from admin popup "Take Tour" button
      startOnboardingTour()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case "clearTour":
      chrome.storage.session.set({ tourActive: false }, () =>
        sendResponse({ ok: true })
      );
      return true;

    default:
      break;
  }
});
