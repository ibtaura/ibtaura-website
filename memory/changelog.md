# Changelog

Newest first. One line per notable change or decision; link the commit where there is one.

- **2026-11-18:** Drafted the keyword ranking plan with timelines (`seo-ranking-plan.md`).
- **2026-11-18:** Added the project memory (`memory/`, `CLAUDE.md`), both excluded from the site through `.assetsignore`.
- **2026-11-18:** Moved duplicated inline CSS into shared stylesheets (`articles`, `legal`, `papers`, `newsroom`, `dataroom`, `clarus`, `careers-contact`.css); inline `<style>` went from 840 KB to 38 KB, and screenshots match before and after (`4a0f3a9`). The remaining inline blocks (index, about, articles hub, newsroom hub, papers index, internal admin and onboarding) are unique per page. To check: in 390-px headless screenshots, article text ran past the right edge both before and after the change; confirm on a real phone.
- **2026-11-18:** Removed the hardcoded password from the Apps Script source (`3a038fb`). The deployed script's password must be managed in Apps Script only.
- **2026-11-18:** Removed 35 unused images and PDFs, 48 MB (`df55bca`).
- **2026-11-18:** Restructured into `articles/`, `newsroom/`, `papers/`, `legal/` and `internal/`, with clean root-absolute links and 301s for every old URL (`25138f1`). Deleted the 4 meta-refresh stub pages.
- **2026-11-18:** Ran the SEO baseline audit; the plan is in `seo-plan.md`. Rule set: never push to `main` without the owner's permission.
