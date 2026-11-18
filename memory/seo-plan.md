# SEO plan

## Baseline audit (2026-11-18)
**Already good:** canonical tags, descriptions, OG and Twitter tags, and JSON-LD on all indexable pages. No duplicate titles. Every image has alt text. The sitemap has no dead URLs. The home page loads only about 259 KB of images.

**Problems found, and their status:**
| # | Issue | Status |
|---|---|---|
| 1 | Internal `.html` links caused a 307 on every click and crawl (4,335 links) | Fixed in the restructure: all links are clean and root-absolute |
| 2 | Redirect chains (`_redirects` targeted `.html`) | Fixed |
| 3 | `http://` and `www.` served 200 instead of redirecting | Open: needs the Cloudflare dashboard |
| 4 | No 404 page | Built in Release 1 (`404.html`); the deploy config still needs `not_found_handling: "404-page"` |
| 5 | Assets sent with `Cache-Control: max-age=0`; no `_headers` | Fixed in Release 1 (`_headers`) |
| 6 | Heavy images (4-10 MB newsroom PNGs) | Partly done: 48 MB of unused files removed; used images not yet compressed |
| 7 | (Release 1: all 65 articles now have dates; authors are still open) 18 of 65 articles had no `datePublished`; the author is always the Organization (weak E-E-A-T for health content) | Open |
| 8 | Stale, uniform sitemap `lastmod` | Fixed in Release 1 (`scripts/build-sitemap.py`) |
| 9 | Some titles over 60 characters or too short; 4 descriptions over 160 | Open |
| 10 | PDFs blocked by robots.txt but still indexable through links; an `X-Robots-Tag` header is the reliable fix | Fixed in Release 1 (header added, robots.txt Disallow removed) |
| 11 | Lenis loaded from unpkg in the home page `<head>`, blocking render | Open |
| 12 | 840 KB of duplicated inline `<style>` across pages | Fixed (`4a0f3a9`): now 38 KB |

## Phases
1. **Technical:** clean URLs and folders (done), redirects (done), 404 page, `_headers` (caching, `X-Robots-Tag`), sitemap generated from git dates.
2. **Performance:** WebP images at sensible widths, lazy loading, defer or self-host Lenis, PageSpeed before and after.
3. **Content and schema:** article dates, real authors and reviewers (Person), title and description fixes, Product schema for Clarus Health (done in Release 1), FAQ blocks, related-article links.
4. **Brand and entity:** see [brand-entity.md](brand-entity.md).
5. **Needs dashboard access:** Cloudflare HTTPS and www redirects; Search Console sitemap resubmission and indexing checks; Bing Webmaster Tools / IndexNow.

Re-run `scripts/seo_audit.py` after each phase and record the result in [changelog.md](changelog.md).
