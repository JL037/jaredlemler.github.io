# jaredlemler.com

Created: 2025-04-25
Last Modified: 2026-10-02

Personal site for Jared Lemler, backend engineer. Plain static HTML with Tailwind (CDN), served by GitHub Pages from `main`. No framework and no server runtime.

## Pages

| Path | File |
|------|------|
| `/` | `index.html` |
| `/resume/` | `resume/index.html` (plain-text copy in `resume/Jared_Lemler_Resume.txt`) |
| `/blog/` | `blog/index.html` |

## Writing feed

`scripts/update-writing.mjs` pulls the latest posts from pckt.blog, straight from my AT Protocol repo:

1. Resolve `did:plc:tsjjh5uzepibeoujgscgfgo4` on plc.directory to find the PDS.
2. `com.atproto.repo.listRecords` on `blog.pckt.document`. Each record strong-refs a `site.standard.document` with the title, dates, and path.
3. Resolve the `site.standard.publication` for the base URL, sort by `publishedAt`, keep the 5 newest.
4. Rewrite the HTML between `<!-- writing:start -->` and `<!-- writing:end -->` on the home and blog pages, and bump `sitemap.xml` for pages that changed.

If any fetch fails, the committed list stays as-is and the script exits 0 with a warning.

## Scripts

Node 20+, zero dependencies.

```bash
npm run writing   # refresh the writing feed
npm run check     # content rules: no em dashes, no retired claims, valid JSON-LD
npm run build     # both
```

## Automation

`.github/workflows/site.yml`:

- **Push / PR:** runs `npm run check`.
- **Mondays 15:00 UTC (and manual dispatch):** refreshes the writing feed, checks it, and commits to `main` only if posts changed. That push redeploys Pages.
