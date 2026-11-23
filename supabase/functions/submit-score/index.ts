// POST /functions/v1/submit-score
// Body: { run, launchEmails }. Header: Authorization: Bearer <the signed-in user's access token>.
// The score is never taken from the browser: the raw run is checked and re-scored here with the same
// scoring.js the game uses, then stored with the service role.
// Replies 200 { score, level, reaction, memory, rules, rankToday, rankAll }, or 4xx { error, reason }.
import { checkRun, scoreRun } from '../_shared/scoring.js';
import { adminClient, getCaller, json, preflight, userClient } from '../_shared/http.ts';

const MAX_BODY_BYTES = 32 * 1024;
const PLAYS_PER_DAY = 20;

// deno-lint-ignore no-explicit-any
type Json = any;

/** Keeps only the fields of the documented run format, so nothing else gets stored. */
function cleanRun(run: Json): Json {
  return {
    v: run.v,
    level: run.level,
    device: run.device,
    reaction: {
      durationSeconds: run.reaction.durationSeconds,
      reactionTimesMs: run.reaction.reactionTimesMs.map(Number),
      falseStarts: run.reaction.falseStarts,
    },
    memory: { rounds: run.memory.rounds.map((r: Json) => ({ length: r.length, correct: r.correct })) },
    rules: {
      trials: run.rules.trials.map((t: Json) => ({
        n: t.n,
        rule: t.rule,
        pivot: t.pivot ?? null,
        isSwitch: Boolean(t.isSwitch),
        answer: t.answer,
        correct: t.correct,
        rtMs: t.rtMs,
      })),
    },
  };
}

function utcDayStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** "Priya Sharma" -> "Priya S." (the same rule as the sign-up trigger), for a profile that is somehow missing. */
function defaultName(fullName: unknown): string {
  const cleaned = String(fullName || '')
    .replace(/[^\p{L}\p{N}\p{M} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Player';
  const parts = cleaned.split(' ');
  let name = parts[0].slice(0, 20);
  if (parts.length > 1) name += ` ${parts[parts.length - 1].slice(0, 1)}.`;
  return name.length >= 2 && name.length <= 24 ? name : 'Player';
}

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  try {
    const declared = Number(req.headers.get('Content-Length') || 0);
    if (declared > MAX_BODY_BYTES) return json(req, 413, { error: 'too_large' });

    const caller = await getCaller(req);
    if (!caller) return json(req, 401, { error: 'unauthorized', reason: 'signIn' });
    const userId = caller.user.id;

    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(req, 413, { error: 'too_large' });
    let body: Json;
    try {
      body = JSON.parse(text);
    } catch {
      return json(req, 400, { error: 'invalid_run', reason: 'badJson' });
    }
    const run = body?.run;
    const launchEmails = body?.launchEmails === true;

    let reason: string | null;
    try {
      // checkRun covers the whole format, including the level, the memory rows the game could have shown and
      // every rules trial (number range, pivot, answer, timing), so no extra checks are needed here.
      reason = checkRun(run);
    } catch {
      reason = 'badShape';
    }
    if (reason) return json(req, 400, { error: 'invalid_run', reason });

    let result: Json;
    try {
      result = scoreRun(run);
    } catch {
      return json(req, 400, { error: 'invalid_run', reason: 'badShape' });
    }
    if (!result.valid || result.overall === null) {
      return json(req, 400, { error: 'invalid_run', reason: result.reason || 'invalid' });
    }

    const admin = adminClient();

    const { count, error: countError } = await admin
      .from('plays')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', utcDayStart());
    if (countError) throw countError;
    if ((count ?? 0) >= PLAYS_PER_DAY) {
      return json(req, 429, { error: 'rate_limited', reason: 'dailyLimit', limit: PLAYS_PER_DAY });
    }

    // The sign-up trigger makes the profile; this only covers an account made before the migration ran.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      const meta = caller.user.user_metadata || {};
      const insertProfile = (display_name: string) =>
        admin.from('profiles').upsert({ user_id: userId, display_name }, { onConflict: 'user_id', ignoreDuplicates: true });
      const first = await insertProfile(defaultName(meta.full_name || meta.name));
      if (first.error) {
        const second = await insertProfile('Player'); // the name had characters the database refuses
        if (second.error) throw second.error;
      }
    }

    const { error: insertError } = await admin.from('plays').insert({
      user_id: userId,
      device: run.device,
      level: result.level,
      overall: result.overall,
      reaction: result.reaction.score,
      memory: result.memory.score,
      rules: result.rules.score,
      valid: true,
      raw: cleanRun(run),
      scoring_version: result.version,
      norms: result.norms,
      median_ms: result.reaction.medianMs,
      speed: result.reaction.speed,
      performance: result.reaction.performance,
      best_span: result.memory.bestSpan,
      rule_accuracy: result.rules.accuracy,
      rule_mean_ms: result.rules.meanCorrectMs,
    });
    if (insertError) throw insertError;

    if (launchEmails) {
      // The profiles trigger stamps launch_emails_at when this turns on; an existing opt-in keeps its date.
      const { error } = await admin.from('profiles').update({ launch_emails: true }).eq('user_id', userId).eq(
        'launch_emails',
        false,
      );
      if (error) console.error('launch_emails update failed', error.message);
    }

    // Ranks as the caller sees them (my_rank uses auth.uid()).
    const asUser = userClient(caller.token);
    const [today, all] = await Promise.all([
      asUser.rpc('my_rank', { period: 'today', device: 'all' }),
      asUser.rpc('my_rank', { period: 'all', device: 'all' }),
    ]);
    const rankOf = (r: { data: Json }) => (Array.isArray(r.data) && r.data[0] ? Number(r.data[0].rank) : null);

    return json(req, 200, {
      score: result.overall,
      level: result.level,
      reaction: result.reaction.score,
      memory: result.memory.score,
      rules: result.rules.score,
      rankToday: rankOf(today),
      rankAll: rankOf(all),
    });
  } catch (err) {
    console.error('submit-score failed', err instanceof Error ? err.message : err);
    return json(req, 500, { error: 'server_error' });
  }
});
