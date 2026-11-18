# Site overview

## Hosting
- **Cloudflare Workers static assets** serve the repo folder (`assets.directory: "."`).
- **Clean URLs:** `/x` serves `x.html`; `/x.html` gets a 307 to `/x`; `/dir/x` serves `dir/x.html`. A root `articles.html` and an `articles/` folder coexist: `/articles` is the hub and `/articles/<slug>` is a page.
- **Not served:** `.assetsignore` keeps `scripts/`, `memory/`, `CLAUDE.md`, `.claude/` and the config files off the site.
- **Redirects:** `_redirects` uses Cloudflare syntax (`/old /new 301`), with up to 2000 static rules.
- **Search Console:** Google Search Console is verified with `googlee2edd652a19f60b8.html`, which must stay at the root.
- **Domain status (2026-11-18):** `http://` and `www.` serve 200 instead of redirecting to `https://adarna.us`. Fix that in the Cloudflare dashboard.

## Layout (since 2026-11-18)
| Path | URL | Contents |
|---|---|---|
| root `*.html` | `/`, `/about`, ... | Hub pages: index, about, careers, contact, data-room, kickstarter, aura-clarus-features, aura-clarus-desktop, articles, newsroom, papers |
| `articles/<slug>.html` | `/articles/<slug>` | 65 Health Library articles |
| `newsroom/2026-MM.html` | `/newsroom/2026-MM` | Monthly company updates |
| `papers/<slug>.html` | `/papers/<slug>` | Evidence-graded research reviews (generated) |
| `legal/<name>.html` | `/legal/<name>` | 14 policies |
| `internal/internal-app.html` | `/internal/internal-app` | Unlisted download page for the team's desktop app (noindex, not in the sitemap). The onboarding form and its admin viewer were removed on 2026-11-18 because the admin password leaked. |
| `assets/css/` | | `style.css` (global), plus page-group sheets (`articles.css`, `legal.css`, `papers.css`, `newsroom.css`, `about.css`) |
| `assets/js/` | | `main.js`, `mobile-nav.js` (holds the nav links), `consent.js`, `analytics-config.js` |
| `assets/images/<topic>/` | | Lowercase-kebab file names: articles, brand, company, desktop, hardware, icons, internal, mobile, newsroom/2026-MM, product, team |
| `assets/docs/{newsroom,kickstarter,company}/` | | PDFs and zips (blocked in robots.txt) |
| `assets/papers/<slug>/` | | Paper PDFs and figures |
| `scripts/` | | `build-papers.py` (LaTeX to paper pages; its sources live off-repo), `build-search-index.py`, `seo_audit.py` |

## Conventions
- **Every page has:** a canonical tag (`https://adarna.us/<clean-path>`), a meta description, OG and Twitter tags, and JSON-LD (Organization, BreadcrumbList; Article or ScholarlyArticle where relevant).
- **Breadcrumbs:** Home > Health Library > article, Home > Newsroom > month, Home > Papers > paper.
- **Stylesheet links:** carry a `?v=N` cache-buster. Bump N whenever the file changes.
