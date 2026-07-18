# Contributing to MyBoycottList

Thanks for your interest in contributing! MyBoycottList (MBL) is a browser extension that helps consumers make informed decisions about the brands they support. Here's how you can help.

## How MBL is curated

MBL uses a **curated-criteria model**: the code is open, the data is open, but **listings are team-maintained**. Every listing must have a documented, sourceable tie to the published criteria — we don't add or remove brands by popular vote, and we don't merge direct edits to the listings data. Instead, suggestions and disputes go through the issue workflows below, where the team verifies sources before anything changes.

## Suggest a brand

Use the **[Brand Suggestion issue template](../../issues/new?template=brand-suggestion.yml)**.

Include primary sources wherever possible — FEC filings, court records, major-outlet reporting. Suggestions with strong sources are reviewed fastest; submissions without sources will be closed as unverifiable.

## Dispute a listing

Use the **[Listing Dispute issue template](../../issues/new?template=listing-dispute.yml)**.

We take accuracy seriously. If a listing is factually wrong, outdated, or you believe the criteria were misapplied, file a dispute with your sources. Brand representatives are welcome to file disputes — please identify yourself as such in the issue.

## Contribute code

Pull requests are welcome for the extension itself (bug fixes, performance, UX polish, docs).

- **Start with a [good first issue](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)** if you're new — they're scoped and self-contained.
- For anything larger, **open an issue first** so we can discuss the approach before you invest time.
- Keep PRs focused: one change per PR, with a clear description of what and why.
- The extension is Manifest V3, vanilla JavaScript, no build step — please keep it that way; don't introduce frameworks or build tooling.
- Test your change locally (load the unpacked extension in Chrome) before submitting.

**Note:** PRs that directly edit the listings data (`Data/boycottlist.json`) will be closed and redirected to the issue workflows above — listings only change through the curated review process.

## Questions

Open an issue, or see the [README](README.md) for project background.
