# Brand and entity: ranking for "Adarna Inc" and "Clarus Health"

## Names (decided 2026-11-18)
- **Company:** Adarna Inc.
- **Product:** **Clarus Health**, renamed from "Aura Clarus". Don't use "Aura" in product naming. The product is a band, plus an iPhone app and the Clarus Health Desktop app for Mac.
- **Positioning:** a health wearable that helps with productivity and burnout. Health comes first; productivity, focus and burnout are the second message.
- **Name risk:** "Clarus Health" is also used by a San Francisco ketamine/NAD clinic (clarus-health.com) and by a 2025 "Clarus Health Inc" trademark filing for behavioral-health services. The owner chose the name anyway. So:
  - always pair it with the company: "Clarus Health by Adarna Inc."
  - the team should run a trademark check before packaging or the Kickstarter

## The search landscape (checked 2026-11-18)
- **Plain "Adarna":** dominated by the Philippine legend Ibong Adarna, Wikipedia, the publisher Adarna House and the actress Ellen Adarna. That isn't a realistic near-term #1.
- **Winnable searches:** "Adarna Inc", "Clarus Health Adarna", "Clarus Health band" or "wearable", "Adarna wearable", "Adarna health band", "Adarna productivity band", and in time "burnout wearable".
- Targets and timelines are in [seo-ranking-plan.md](seo-ranking-plan.md).

## On the site
- **Full Organization JSON-LD** (`@id https://adarna.us/#organization`), on home and about only. Every other page references it by `@id`. Fields:
  - name, alternateName, legalName "Adarna Inc."
  - sameAs (below)
  - the San Francisco address
  - brand "Clarus Health"
  - founders and foundingDate, once the owner provides them
  - a square PNG logo
- **Product JSON-LD:** on `/clarus-health`, with manufacturer set to the organization @id.
- **Titles:** "... | Adarna Inc."; product pages use "Clarus Health ... | Adarna Inc.".

## Profile links for `sameAs`
- LinkedIn: https://www.linkedin.com/company/adarna-inc
- Crunchbase: https://www.crunchbase.com/organization/adarna-2e71
- GitHub (organisation): https://github.com/ibtaura
- To add when available: X, Instagram, YouTube, App Store, Kickstarter campaign, Product Hunt, and Wikidata (once press coverage exists)

## Off-site work (owner)
- **Rename everywhere:** change "Aura Clarus" to "Clarus Health" on LinkedIn, Crunchbase, Kickstarter and the app store and app names. Use the same company name, website and address everywhere.
- **Google Business Profile:** skip it unless there's a staffed office. The current address looks like a mailbox, which Google doesn't allow.
- **Backlinks:** press, directories (Wellfound, BetaList, F6S), roundup writers and podcasts that mention "Adarna Inc" or "Clarus Health".
- **Tracking:** check Search Console monthly for "adarna inc", "clarus health adarna", "clarus health", "adarna productivity band" and "burnout wearable".
