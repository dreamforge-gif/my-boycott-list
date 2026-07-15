# MyBoycottList — Private Beta install (dev-load)

Built by Engineering Lead, 2026-06-10. This is the **Wave 0 private-beta install path** that avoids the Chrome Web Store dependency (DRE-24), per Nova direction (comms 2026-06-06 14:11, Decision 2).

Extension version: **0.4.14** (matches the repo `manifest.json`).

## What's in the package

`MyBoycottList-beta.zip` contains the full unpacked extension:

```
MyBoycottList/
  manifest.json        (MV3)
  background.js        (service worker)
  content_script.js    (page flagging)
  admin.html / admin.js (popup)
  config.json          (Supabase URL + publishable anon key + dataset endpoint)
  Data/boycottlist.json (local fallback list)
  icons/               (16/32/48/128)
```

## Install steps (testers)

1. Download `MyBoycottList-beta.zip` and unzip it to a folder you'll keep (the browser loads the extension live from this folder — don't delete or move it).
2. Open `chrome://extensions` (works in Chrome, Edge, Brave, and other Chromium browsers).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the unzipped `MyBoycottList` folder.
5. The MyBoycottList icon appears in the toolbar. Pin it if you like.

> **What to expect:** You may see banners on multiple sites as you browse — the extension flags every listed brand, not just the one you started on. That's coverage working as intended across all 34 listed brands.

To update to a newer beta build: replace the folder contents and click the refresh icon on the extension's card in `chrome://extensions`.

## Notes for the team

- The dev-load path removes the 2-week Brandolon/CWS dependency from Wave 0 entirely. CWS publish (DRE-24) stays as the **Wave 1** soft-public gate, not Wave 0.
- `beta_landing.html` (built same day) links to this zip via the `INSTALL_LINK_HERE` placeholder — fill it with the hosted zip URL once the page + zip are hosted.
- The page's feedback form POSTs to `mbl_beta_feedback` in the MyBoycottList Supabase project (`sykzevzycuogbsyorrki`). **That table is not yet applied** — it's gated on mbl-pm's project-level RLS sign-off (Nova 2026-06-06 23:11). The form goes live the moment the staged migration (`ENG_beta-feedback-migration_2026-06-06.sql`) is applied.
