# Attention Test leaderboard: Supabase setup

The game at https://adarna.us/attention-test works with no backend. This folder adds the optional
leaderboard: Google sign-in, a database of plays, and two small server functions. Until you finish the
steps below the page simply shows "Leaderboard opens soon".

What is in here:

| Path | What it is |
|---|---|
| `migrations/*_attention_test.sql` | Tables `profiles` and `plays`, security rules, the `board()` and `my_rank()` queries |
| `migrations/*_friends.sql`, `*_no_friend_removal.sql` | Friend codes, `friendships`, `add_friend()` and `friends_board()` (friends can't remove each other) |
| `migrations/*_levels.sql` | `plays.level` (Easy / Normal / Hard) and the board queries returning each best run's level. The game now always plays Normal; the column stays for old runs |
| `migrations/*_my_best.sql` | `my_best()`: the signed-in player's own best valid run (raw, score, level, date) for "Share my best score" |
| `functions/submit-score/` | Checks and re-scores a run on the server, then saves it (20 per person per UTC day) |
| `functions/delete-me/` | Deletes the person's sign-in, which also deletes their profile and plays. The page has no "Remove my data" button (owner's decision: deletion is by email, privacy policy 1.4), so nothing calls it today |
| `functions/_shared/scoring.js` | An exact copy of `assets/js/attention-test/scoring.js` (keep them identical) |
| `config.toml` | Settings for the Supabase command line tool |

The repo is public. Never paste the **service_role** key, the Google **client secret** or your database
password into any file here. Only the Project URL and the **anon** key go in the website.

You need: a Google account that can use Google Cloud, Node.js (for `npx`), and about 30 minutes.
All commands are typed in **PowerShell** inside the repo folder.

---

## 1. Create the Supabase project

1. Go to https://supabase.com and sign in (GitHub or email). Click **New project**.
2. Organization: pick yours (or create one). Name: `adarna-attention-test`.
3. **Database password**: click *Generate a password* and save it in your password manager. You need it once, in step 5.
4. **Region**: pick the one closest to most players (for India, *South Asia (Mumbai)*; for the US, *East US*).
5. Plan: **Free**. Click **Create new project** and wait about two minutes.
6. Note the **project ref**: the part of the dashboard address after `/project/`, for example
   `abcdefghijklmnopqrst`. Your project URL is `https://<ref>.supabase.co`.

## 2. Put the public keys in the website

1. In Supabase, open **Project Settings** (gear icon) → **API** (or **API Keys**).
2. Copy the **Project URL** and the **anon public** key (it starts with `eyJ`; on newer dashboards it may be
   under the *Legacy API keys* tab, or you can use the **publishable** key that starts with `sb_publishable_`).
3. Open `assets/js/attention-test/supabase-config.js` and fill in:

   ```js
   export const SUPABASE_URL = 'https://<ref>.supabase.co';
   export const SUPABASE_ANON_KEY = '<the anon / publishable key>';
   ```

   These two are safe to publish: every visitor's browser gets them anyway, and the database rules decide
   what they can do. Do **not** use the `service_role` / `sb_secret_` key here.
4. Files under `/assets/js/` are cached by browsers for a year, so make them fetch the new values:
   in `assets/js/attention-test/board.js` change `./supabase-config.js?v=1` to `?v=2`, then bump the `?v=`
   on every line that loads `board.js` (in `game.js` and `leaderboard-page.js`), and then on the scripts that load
   those two (`attention-test.html` and `attention-test/leaderboard.html`).

## 3. Google sign-in (Google Cloud console)

1. Go to https://console.cloud.google.com, pick or create a project (for example `Adarna Website`).
2. **APIs & Services → OAuth consent screen** (on newer consoles: **Google Auth Platform → Branding**):
   - User type: **External**. App name: **Adarna**. User support email: `<your support email>`.
   - App logo: optional (adding one can trigger Google's review; it is fine to skip).
   - **Authorized domains**: add `adarna.us` and `supabase.co`.
   - Developer contact email: `<your email>`. Save.
   - Scopes: keep the defaults (`openid`, `email`, `profile`). Nothing else is needed.
   - **Publish the app** (Audience → *Publish app*), or only test users can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**. Name: `Adarna leaderboard`.
   - **Authorized JavaScript origins**: `https://adarna.us` (add `http://localhost:8787` for local testing).
   - **Authorized redirect URIs**: `https://<ref>.supabase.co/auth/v1/callback`
   - Click **Create**. Copy the **Client ID** and **Client secret** (keep the secret private).
4. Back in Supabase: **Authentication → Sign In / Providers → Google** → turn it on, paste the Client ID
   and Client secret, **Save**.

## 4. Allowed sign-in return addresses (Supabase)

**Authentication → URL Configuration**:

- **Site URL**: `https://adarna.us`
- **Redirect URLs** (add each):
  - `https://adarna.us/attention-test`
  - `http://localhost:8787/attention-test`
  - `https://*-ibtaura-website.*.workers.dev/attention-test` (Cloudflare preview builds; check the exact
    preview host in Cloudflare → Workers & Pages → ibtaura-website → Deployments and adjust the pattern)

Save.

## 5. Create the tables and deploy the functions (command line)

In PowerShell, in the repo folder:

```powershell
npx supabase login                                   # opens the browser once
npx supabase link --project-ref <ref>                # asks for the database password from step 1
npx supabase db push                                 # creates the tables, rules and board queries
npx supabase functions deploy submit-score
npx supabase functions deploy delete-me
npx supabase secrets set ALLOWED_ORIGINS="https://adarna.us,https://*.workers.dev,http://localhost:8787"
```

- `db push` runs the SQL in `migrations/`. Run it again only after adding a new migration file.
- The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically;
  you don't set those. A project with only the new API keys (no legacy JWT keys) may not get the last two;
  then set them yourself in the terminal, never in a file: `npx supabase secrets set SB_PUBLISHABLE_KEY=sb_publishable_... SB_SECRET_KEY=sb_secret_...`.
  The functions use those names as a fallback.
- `ALLOWED_ORIGINS` is the list of pages allowed to call the functions (a `*` matches any sub-domain part).
  Those three are also the built-in default, so this command is optional. To lock previews down, replace
  `https://*.workers.dev` with your exact preview pattern, e.g. `https://*-ibtaura-website.<account>.workers.dev`.
- `config.toml` turns off the gateway's own token check for both functions (`verify_jwt = false`) because
  each function verifies the signed-in user itself. If you deploy without the config file, add
  `--no-verify-jwt` to the two deploy commands.

## 6. Check it works

1. Open https://adarna.us/attention-test (or the preview), play a run, click **Continue with Google**.
2. After Google sends you back you should see "You're #1 today" and your row highlighted on the board.
3. In Supabase → **Table Editor** you should see one row in `profiles` and one in `plays`.
4. Try **Edit name**, the **Show me on the board** switch and **Sign out**.

If sign-in fails with "redirect_uri_mismatch", the redirect URI in step 3 doesn't exactly match
`https://<ref>.supabase.co/auth/v1/callback`. If you come back signed out, the page address isn't in the
Redirect URLs list from step 4. Function logs: Supabase → **Edge Functions** → pick one → **Logs**.

## Good to know

- **The free plan pauses a project after 7 days with no activity.** The board then shows "Couldn't load the
  leaderboard" (the game still works). Open the Supabase dashboard and click **Restore project**. Regular
  traffic keeps it awake; upgrade to Pro if a pause would be a problem.
- **Daily limit**: 20 saved runs per person per UTC day; the 21st gets a friendly "That's today's limit".
- **Days are UTC.** *Today* starts at 00:00 UTC; *This week* is the rolling last 7 days.
- **What the public can see**: rank, display name, score, Phone/Computer and the time of the best run (the
  queries also return the run's level, but new runs are always Normal). Never emails, user ids, friend codes or raw runs.
- **One level, one score (since 23 Nov 2026).** The game always plays Normal: there is no level picker, badge or
  `l=` link parameter any more. `scoring.js` (and so `submit-score`) still accepts Easy and Hard runs, with their
  level bonus on the overall score (Easy -10, Hard +10), so old runs, old links and old board rows stay valid.
  `board()`, `my_rank()` and `friends_board()` rank everything on one board. Plays saved before the levels
  migration count as Normal. Dropping Easy and Hard for good means editing `scoring.js`, re-syncing it,
  updating the tests and redeploying `submit-score`.
- **"Show me on the global board"** (`profiles.show_on_board`) hides a player from `board()` only. Friends always
  see each other on `friends_board()`, and a hidden player still sees their own rank in `my_rank()`.
- **Scoring changes**: edit `assets/js/attention-test/scoring.js`, copy it over with
  `python scripts/build-attention-share.py --sync-scoring`, then `npx supabase functions deploy submit-score`.
  Every raw run is stored in `plays.raw`, so scores can be recomputed later.

## Export the "Email me when Clarus Health launches" list

Supabase → **SQL Editor** → New query, run:

```sql
select u.email, p.display_name, p.launch_emails_at
from public.profiles p
join auth.users u on u.id = p.user_id
where p.launch_emails
order by p.launch_emails_at;
```

Then **Download CSV**. Treat that file as private (don't commit it). People who later untick the box or
remove their data drop off this list automatically.
