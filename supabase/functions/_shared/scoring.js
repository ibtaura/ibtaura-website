// Clarus Attention Test: rules, the raw-run format and scoring.
//
// One plain ES module with no imports, loaded by the browser (to show the score) and copied to
// supabase/functions/_shared/scoring.js (to re-score every leaderboard entry on the server).
// Keep the two copies identical: scripts/build-attention-share.py --sync-scoring copies this file over.
//
// Sources for the rules:
// - Reaction: the Clarus Health Quick Check part 1 (iOS ReactionRun.swift; PVT-B after Basner 2011, 45 s).
// - Memory: the Android Quick Check memory part (clarus_android QuickCheckEngine.kt, SpanTest).
// - Rules: the iOS Quick Check part 2 (RuleSwitchModel.swift), shortened to 10 digits.
// - Measures: the server's attention.ts (speed = mean 1000/RT, performance = 1 - (slow + too soon) / (answers + too soon)).
//
// The raw run, as the game builds it and the server receives it:
// {
//   v: 1,
//   device: 'phone' | 'computer',
//   reaction: { durationSeconds: 45, reactionTimesMs: number[], falseStarts: number },
//     // one time per dot in order; an unanswered dot holds REACTION.timeoutMs
//   memory: { rounds: [{ length: number, correct: boolean }] },
//     // one per row answered, in order; a row still showing or half typed at time-up is left out
//   rules: { trials: [{ digit: number, rule: 'parity' | 'magnitude', isSwitch: boolean,
//                       answer: 'odd' | 'even' | 'lower' | 'higher' | null, correct: boolean, rtMs: number | null }] }
//     // answer null and rtMs null when the 3 s ran out
// }

export const SCORING_VERSION = 1;

export const REACTION = Object.freeze({
  durationSeconds: 45,
  minGapMs: 1000,
  maxGapMs: 4000,
  showResultMs: 1000,
  timeoutMs: 30000,
  falseStartMs: 100,
  lapseMs: 355,
  fewestAnswers: 8,
  mostFalseStartShare: 0.2,
});

export const MEMORY = Object.freeze({
  durationSeconds: 45,
  startLength: 3,
  maxLength: 9,
  showPerDigitMs: 1000,
  feedbackMs: 800,
  missesToEnd: 2,
});

export const RULES = Object.freeze({
  trials: 10,
  answerWindowMs: 3000,
  blankMs: 500,
  // Answers faster than this can't have read the digit and the rule.
  fastestMs: 150,
});

// Score scale, as in the app: 100 is typical, one standard deviation is 15 points.
export const SCALE = Object.freeze({ mean: 100, pointsPerSd: 15, min: 40, max: 160 });

export const WEIGHTS = Object.freeze({ reaction: 0.4, memory: 0.3, rules: 0.3 });
// The weighted mean of three part z-scores spreads less than one part. Assuming the parts correlate about 0.3,
// its SD is sqrt(sum w^2 + 2*0.3*sum wi*wj) = 0.73; dividing by it keeps the overall score on 100 +/- 15.
export const COMPOSITE_SD = 0.73;

// Beta norms for a browser on an ordinary device, from published values. Every raw run is stored, so
// these are re-fitted from real plays later (see memory/attention-test.md). Bump NORMS_VERSION then.
export const NORMS_VERSION = 'beta-1';
export const NORMS = Object.freeze({
  speed: { mean: 3.6, sd: 0.45 }, // mean of 1000/RT; about 280 ms
  performance: { mean: 0.88, sd: 0.1 },
  span: { mean: 5.5, sd: 1.1 }, // longest row typed back right; 45 s at 1 s per digit tops out near 8
  accuracy: { mean: 0.9, sd: 0.1 },
  ruleTimeMs: { mean: 1100, sd: 250 },
});

const round = (x, places = 0) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const z = (value, norm) => (value - norm.mean) / norm.sd;
const toScore = (zValue) => round(clamp(SCALE.mean + SCALE.pointsPerSd * zValue, SCALE.min, SCALE.max));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Part 1. Mirrors the server's PVT measures. */
export function scoreReaction(reaction) {
  const all = reaction.reactionTimesMs;
  const rts = all.filter((rt) => rt >= REACTION.falseStartMs && rt < REACTION.timeoutMs);
  const timeouts = all.filter((rt) => rt >= REACTION.timeoutMs).length;
  const falseStarts = reaction.falseStarts + all.filter((rt) => rt < REACTION.falseStartMs).length;
  const answers = rts.length;
  const slow = rts.filter((rt) => rt >= REACTION.lapseMs).length + timeouts;
  const base = { answers, slow, falseStarts, medianMs: median(rts) === null ? null : round(median(rts)) };
  if (answers < REACTION.fewestAnswers) return { ...base, valid: false, reason: 'tooFewAnswers' };
  if (falseStarts > REACTION.mostFalseStartShare * (answers + falseStarts)) {
    return { ...base, valid: false, reason: 'tooManyFalseStarts' };
  }
  const speed = rts.reduce((a, rt) => a + 1000 / rt, 0) / answers;
  const performance = 1 - (slow + falseStarts) / (answers + timeouts + falseStarts);
  const zValue = 0.5 * z(speed, NORMS.speed) + 0.5 * z(performance, NORMS.performance);
  return { ...base, valid: true, speed: round(speed, 4), performance: round(performance, 4), score: toScore(zValue) };
}

/** Part 2. The longest row typed back right. */
export function scoreMemory(memory) {
  const rounds = memory.rounds;
  const bestSpan = rounds.reduce((best, r) => (r.correct ? Math.max(best, r.length) : best), 0);
  const correct = rounds.filter((r) => r.correct).length;
  return { valid: true, bestSpan, correct, attempts: rounds.length, score: toScore(z(bestSpan, NORMS.span)) };
}

/** Part 3. Accuracy and the mean time of right answers (10 digits are too few for a switch cost). */
export function scoreRules(rules) {
  const trials = rules.trials;
  const right = trials.filter((t) => t.correct && isNum(t.rtMs));
  const accuracy = trials.length ? right.length / trials.length : 0;
  const meanCorrectMs = right.length ? right.reduce((a, t) => a + t.rtMs, 0) / right.length : RULES.answerWindowMs;
  const zValue = 0.5 * z(accuracy, NORMS.accuracy) - 0.5 * z(meanCorrectMs, NORMS.ruleTimeMs);
  return {
    valid: true,
    correct: right.length,
    total: trials.length,
    accuracy: round(accuracy, 4),
    meanCorrectMs: round(meanCorrectMs),
    score: toScore(zValue),
  };
}

/**
 * Scores a whole run. `valid` is false only when the reaction part can't be scored (the app's rule);
 * then `overall` is null and `reason` says why ('tooFewAnswers' | 'tooManyFalseStarts').
 */
export function scoreRun(run) {
  const reaction = scoreReaction(run.reaction);
  const memory = scoreMemory(run.memory);
  const rules = scoreRules(run.rules);
  const valid = reaction.valid;
  const overall = valid
    ? toScore(
        (WEIGHTS.reaction * (reaction.score - SCALE.mean) +
          WEIGHTS.memory * (memory.score - SCALE.mean) +
          WEIGHTS.rules * (rules.score - SCALE.mean)) /
          SCALE.pointsPerSd /
          COMPOSITE_SD,
      )
    : null;
  return {
    version: SCORING_VERSION,
    norms: NORMS_VERSION,
    valid,
    reason: valid ? null : reaction.reason,
    overall,
    reaction,
    memory,
    rules,
  };
}

/**
 * Checks that a raw run has the right shape and could have been played by a person.
 * Returns null when it passes, or a short reason. The server runs this before scoring.
 */
export function checkRun(run) {
  if (!run || typeof run !== 'object' || run.v !== 1) return 'badVersion';
  if (run.device !== 'phone' && run.device !== 'computer') return 'badDevice';
  const r = run.reaction;
  if (!r || !Array.isArray(r.reactionTimesMs) || !Number.isInteger(r.falseStarts) || r.falseStarts < 0) return 'badReaction';
  if (r.durationSeconds !== REACTION.durationSeconds) return 'badReaction';
  if (!r.reactionTimesMs.every((x) => isNum(x) && x >= 0 && x <= REACTION.timeoutMs)) return 'badReaction';
  // Every dot and every false start is followed by at least the shortest gap.
  if (r.reactionTimesMs.length + r.falseStarts > Math.ceil((REACTION.durationSeconds * 1000) / REACTION.minGapMs)) {
    return 'impossibleReaction';
  }
  const rts = r.reactionTimesMs.filter((rt) => rt >= REACTION.falseStartMs && rt < REACTION.timeoutMs);
  if (rts.length >= REACTION.fewestAnswers && median(rts) < 150) return 'impossibleReaction';

  const m = run.memory;
  if (!m || !Array.isArray(m.rounds) || m.rounds.length > 20) return 'badMemory';
  let length = MEMORY.startLength;
  let missesAtLength = 0;
  let shownMs = 0;
  let ended = false;
  for (const row of m.rounds) {
    // No row can follow the end of the part (two misses at one length, or a right answer at the longest).
    if (ended) return 'impossibleMemory';
    if (!row || row.length !== length || typeof row.correct !== 'boolean') return 'impossibleMemory';
    shownMs += row.length * MEMORY.showPerDigitMs;
    if (row.correct) {
      if (length >= MEMORY.maxLength) ended = true;
      else {
        length += 1;
        missesAtLength = 0;
      }
    } else {
      missesAtLength += 1;
      if (missesAtLength >= MEMORY.missesToEnd) ended = true;
    }
  }
  if (shownMs > MEMORY.durationSeconds * 1000 + 1000) return 'impossibleMemory';

  const t = run.rules;
  // The game always records every digit; one with no answer has answer null.
  if (!t || !Array.isArray(t.trials) || t.trials.length !== RULES.trials) return 'badRules';
  for (const trial of t.trials) {
    if (!trial || !Number.isInteger(trial.digit) || trial.digit < 1 || trial.digit > 9 || trial.digit === 5) return 'badRules';
    if (trial.rule !== 'parity' && trial.rule !== 'magnitude') return 'badRules';
    const expected =
      trial.rule === 'parity' ? (trial.digit % 2 ? 'odd' : 'even') : trial.digit < 5 ? 'lower' : 'higher';
    if (trial.answer === null) {
      if (trial.correct || trial.rtMs !== null) return 'badRules';
      continue;
    }
    if (!isNum(trial.rtMs) || trial.rtMs < RULES.fastestMs || trial.rtMs > RULES.answerWindowMs) return 'impossibleRules';
    if (trial.correct !== (trial.answer === expected)) return 'badRules';
  }
  return null;
}

/** Share of people expected below a score on the 100 ± 15 scale (normal approximation), 1-99. */
export function percentileOf(score) {
  const x = (score - SCALE.mean) / SCALE.pointsPerSd / Math.SQRT2;
  // Abramowitz-Stegun 7.1.26 erf approximation.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const erf = x >= 0 ? y : -y;
  return clamp(Math.round(50 * (1 + erf)), 1, 99);
}

/** Copy for each band of the overall score, used on the result screen and the share card. */
export function bandOf(score) {
  if (score >= 130) return { key: 'laser', label: 'Laser focus' };
  if (score >= 115) return { key: 'sharp', label: 'Sharp' };
  if (score >= 100) return { key: 'steady', label: 'Steady' };
  if (score >= 85) return { key: 'drifting', label: 'A little foggy' };
  return { key: 'foggy', label: 'Running on empty' };
}
