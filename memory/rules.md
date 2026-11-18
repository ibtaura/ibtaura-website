# House rules

1. **Never push to, merge into, or update `main` without the owner's explicit permission, every time.** A push to `main` deploys the live site through Cloudflare. Approval for one change does not carry over to the next.
2. **Work on a branch** (for example `seo-optimization`), push the branch, and open a PR. Preview before going live.
3. **Commits:** author them as the repo's configured git user, with no AI co-author or attribution lines.
4. **Public repo and public site:** never commit secrets (passwords, API keys, tokens). Anything at the repo root is served at `https://adarna.us/<path>` unless `.assetsignore` excludes it, so put tooling in `scripts/` (excluded) and notes in `memory/` (excluded).
5. **No CI workflows without review.** In Nov 2026 a compromised account pushed workflows that stole repo secrets; they were removed in `ffebc72`. Treat any new `.github/` or "ci:" commit by an unexpected author as hostile.
6. **Moving or renaming a page or asset changes its public URL.** Add a 301 in `_redirects` from the old path (with and without `.html`) straight to the final clean URL, with no chains.
7. **Links:** use root-absolute, extensionless URLs (`/articles/hrv`, `/assets/...`). Never use relative paths or `.html` links, because pages live in subfolders.
8. **Verify before committing:** run a link check (every internal href, src and srcset resolves), make sure every old URL still redirects, take before and after screenshots for visual changes, and re-run `scripts/seo_audit.py`.
9. **Search index:** after adding or renaming pages, regenerate it with `scripts/build-search-index.py`, and update `sitemap.xml`.
