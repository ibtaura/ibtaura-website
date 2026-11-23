# Attention Test (/attention-test)

A free, roughly 2-minute browser game built from the Clarus Health app's Quick Check, made for marketing. Visitors play, get an "Attention" score, share a score card, and challenge friends. Built on branch `attention-test`, started 2026-11-23.

## Decisions (owner, 2026-11-23)
- **Three parts:**
  - Reaction: 45 s, tap the green dot (iOS Quick Check part 1).
  - Digit memory: 45 s (the Android memory test).
  - Rule switch: 10 digits, odd/even or lower/higher than 5 (iOS part 2, shortened).
- **Score:** 100 = typical, 15 points = one standard deviation, the same style as the app. In the app, 100 means *your own* normal; on the website it means a typical player, because strangers have to be ranked against each other.
- **No login to play or share.** Google sign-in is needed only to join the leaderboard.
- **Backend:** Supabase (Auth with Google, Postgres, Edge Functions). Setup steps are in `supabase/README.md`. The site itself stays static.

## How it fits together
- `assets/js/attention-test/scoring.js` holds the rules, the raw-run format, the scoring, `checkRun` (the plausibility check) and the norms. **The server uses a byte-for-byte copy:** `supabase/functions/_shared/scoring.js`. Re-sync and check it with `scripts/build-attention-share.py --sync-scoring` / `--check` whenever scoring.js changes.
- **Never trust a browser score:** the `submit-score` Edge Function re-scores the raw run.
- **Engines:** `reaction.js`, `memory.js` and `rules.js` are pure state machines, tested by `node --test scripts/tests/`. `game.js` runs the screens.
- **Sharing:** `share.js` draws the story card (1080×1920) and the post card (1200×630) on a canvas, and uses the Web Share API with the image file where it's available.
- **Challenge links:** `/attention-test/s/<score>?by=<name>` are 121 static pages (scores 40–160) with their own og:title and og:image, so link previews show the score with no server. Each one redirects to `/attention-test?challenge=<n>&by=<name>`. `scripts/build-attention-share.py` generates the pages and `assets/images/attention-test/og/*.png`. They are noindex, with a canonical to `/attention-test`, and are not in the sitemap.
- **Leaderboard:** `board.js` and `supabase-config.js` hold the project URL and anon key. These are public by design; RLS protects the data. While the config is empty, the board shows "opens soon".

## Norms
`NORMS_VERSION = 'beta-1'` holds published values for a browser:

| Measure | Mean | SD |
|---|---|---|
| speed (mean 1000/RT) | 3.6 | 0.45 |
| performance | 0.88 | 0.10 |
| longest digit row | 5.5 | 1.1 |
| rule accuracy | 0.9 | 0.1 |
| mean time of right rule answers | 1100 ms | 250 |

The 45 s memory limit at 1 s per digit tops out near 8 digits, which is why the span norm is lower than the classic 7 ± 2.

- **Part scores:** 100 + 15·z, kept between 40 and 160.
- **Overall:** (0.4·R + 0.3·M + 0.3·Rules) as a z-score, divided by `COMPOSITE_SD` 0.73, which assumes the parts correlate about 0.3.

**Re-fit after about 500 valid plays:** take means and SDs from `plays`, one best run per user, split by device if phones and computers differ by more than about 20 ms. Then update `NORMS`, bump `NORMS_VERSION`, and re-sync the server copy:

```sql
select device, count(*),
  avg(speed), stddev(speed), avg(performance), stddev(performance),
  avg(best_span), stddev(best_span), avg(rule_accuracy), stddev(rule_accuracy),
  avg(rule_mean_ms), stddev(rule_mean_ms)
from plays where valid group by device;
```

## Open items
- **Owner setup:** create the Supabase project and the Google OAuth web client (see `supabase/README.md`), then fill in `supabase-config.js`.
- **Google consent screen:** it shows the supabase.co address unless a paid custom domain is set up.
- **Free plan:** a free Supabase project pauses after 7 days with no activity.
- **Later ideas:** a daily challenge (the same sequence for everyone), team or office boards, and a monthly "Attention report" newsroom post built from the combined data.
