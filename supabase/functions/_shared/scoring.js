// Clarus Attention Test: rules, levels, the raw-run format and scoring.
//
// One plain ES module with no imports, loaded by the browser (to show the score) and copied to
// supabase/functions/_shared/scoring.js (to re-score every leaderboard entry on the server).
// Keep the two copies identical: scripts/build-attention-share.py --sync-scoring copies this file over.
//
// Sources for the rules:
// - Reaction: the Clarus Health Quick Check part 1 (iOS ReactionRun.swift; PVT-B after Basner 2011, 45 s).
// - Memory: the Android Quick Check memory part (clarus_android QuickCheckEngine.kt, SpanTest).
// - Rules: the iOS Quick Check part 2 (RuleSwitchModel.swift), shortened to 10 trials, with a third rule
//   (multiple of 3) and comparison numbers that change by level.
// - Measures: the server's attention.ts (speed = mean 1000/RT, performance = 1 - (slow + too soon) / (answers + too soon)).
//
// The raw run, as the game builds it and the server receives it (v 2; any other v is refused):
// {
//   v: 2,
//   level: 'easy' | 'normal' | 'hard',   // a key of LEVELS: sets the dot (size, place), the memory start length and
//                                        // show time, and the rule-switch questions; reaction timing is the same
//   device: 'phone' | 'computer',
//   reaction: { durationSeconds: 45, reactionTimesMs: number[], falseStarts: number },
//     // one time per dot in order; an unanswered dot holds REACTION.timeoutMs
//   memory: { rounds: [{ length: number, correct: boolean }] },
//     // one per row answered, in order, starting at the level's memoryStartLength; a row still showing or half
//     // typed at time-up is left out
//   rules: { trials: [{ n: integer, rule: 'parity' | 'magnitude' | 'multiple3', pivot: integer | null,
//                       isSwitch: boolean, answer: 'odd' | 'even' | 'lower' | 'higher' | 'yes' | 'no' | null,
//                       correct: boolean, rtMs: number | null }] }
//     // exactly RULES.trials (10). n is within the level's [numberMin, numberMax] and rule is one of the level's
//     // rules. pivot is set only for 'magnitude' (one of the level's pivots, never equal to n), null otherwise.
//     // Right answers: parity -> n odd ? 'odd' : 'even'; magnitude -> n < pivot ? 'lower' : 'higher';
//     // multiple3 -> n % 3 === 0 ? 'yes' : 'no'. answer null and rtMs null when the level's answer window ran out.
// }
//
// Levels: every part has its own norms per level (LEVEL_NORMS), so a part score of 100 is a typical player AT THAT
// LEVEL. LEVEL_BONUS is then added to the overall score (not to the part scores), so one board ranks every level.

export const SCORING_VERSION = 2;

export const LEVEL_KEYS = Object.freeze(['easy', 'normal', 'hard']);
export const DEFAULT_LEVEL = 'normal';

const freezeLevel = (o) =>
  Object.freeze({ ...o, reactionDot: Object.freeze({ ...o.reactionDot }), rules: Object.freeze([...o.rules]), pivots: Object.freeze([...o.pivots]) });
// reactionDot.position: 'center' (the middle of the pad every time) or 'random' (a new spot inside the pad each dot).
export const LEVELS = Object.freeze({
  easy: freezeLevel({
    label: 'Easy',
    reactionDot: { sizePx: 140, position: 'center' },
    memoryStartLength: 3,
    memoryShowPerDigitMs: 1200,
    rules: ['parity', 'magnitude'],
    pivots: [5],
    numberMin: 1,
    numberMax: 9,
    answerWindowMs: 4000,
  }),
  normal: freezeLevel({
    label: 'Normal',
    reactionDot: { sizePx: 96, position: 'random' },
    memoryStartLength: 3,
    memoryShowPerDigitMs: 1000,
    rules: ['parity', 'magnitude', 'multiple3'],
    pivots: [3, 4, 5, 6, 7],
    numberMin: 1,
    numberMax: 9,
    answerWindowMs: 3000,
  }),
  hard: freezeLevel({
    label: 'Hard',
    reactionDot: { sizePx: 56, position: 'random' },
    memoryStartLength: 4,
    memoryShowPerDigitMs: 750,
    rules: ['parity', 'magnitude', 'multiple3'],
    pivots: [25, 40, 50, 60, 75],
    numberMin: 12,
    numberMax: 98,
    answerWindowMs: 2500,
  }),
});

/** Points added to the overall score (on the 100 +/- 15 scale) after the level's own norms; part scores get none. */
export const LEVEL_BONUS = Object.freeze({ easy: -10, normal: 0, hard: 10 });

/** The settings of a level key, or null when the key is unknown. */
export const levelOf = (key) => (typeof key === 'string' && LEVEL_KEYS.includes(key) ? LEVELS[key] : null);

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

// The first row's length and the show time per digit come from the level: LEVELS[level].memoryStartLength and
// .memoryShowPerDigitMs. startLength here is the Normal value, kept for older callers; use the level's.
export const MEMORY = Object.freeze({
  durationSeconds: 45,
  startLength: 3,
  maxLength: 9,
  feedbackMs: 800,
  missesToEnd: 2,
});

// The answer window comes from the level: LEVELS[level].answerWindowMs.
export const RULES = Object.freeze({
  trials: 10,
  blankMs: 500,
  // Answers faster than this can't have read the number and the rule.
  fastestMs: 150,
});

/** The two answer words of each rule, in button order (left, right). */
export const RULE_ANSWERS = Object.freeze({
  parity: Object.freeze(['odd', 'even']),
  magnitude: Object.freeze(['lower', 'higher']),
  multiple3: Object.freeze(['yes', 'no']),
});

/** The right answer for a number under a rule (pivot is used only by 'magnitude'). */
export function expectedAnswer(rule, n, pivot = null) {
  if (rule === 'parity') return n % 2 ? 'odd' : 'even';
  if (rule === 'magnitude') return n < pivot ? 'lower' : 'higher';
  if (rule === 'multiple3') return n % 3 === 0 ? 'yes' : 'no';
  return null;
}

// Score scale, as in the app: 100 is typical, one standard deviation is 15 points.
export const SCALE = Object.freeze({ mean: 100, pointsPerSd: 15, min: 40, max: 160 });

export const WEIGHTS = Object.freeze({ reaction: 0.4, memory: 0.3, rules: 0.3 });
// The weighted mean of three part z-scores spreads less than one part. Assuming the parts correlate about 0.3,
// its SD is sqrt(sum w^2 + 2*0.3*sum wi*wj) = 0.73; dividing by it keeps the overall score on 100 +/- 15.
export const COMPOSITE_SD = 0.73;

// Beta norms for a browser on an ordinary device, from published values. Every raw run is stored, so
// these are re-fitted from real plays later (see memory/attention-test.md). Bump NORMS_VERSION then.
// Every measure has norms per level: speed (mean of 1000/RT; 3.5 is about 285 ms) and performance for the reaction
// part (a big centred dot is found faster than a small moving one), span (longest row typed back right) for memory,
// and accuracy and ruleTimeMs (mean time of right answers) for the rule switch.
export const NORMS_VERSION = 'beta-2';
const freezeNorms = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));
export const LEVEL_NORMS = Object.freeze({
  easy: freezeNorms({
    speed: { mean: 3.7, sd: 0.45 },
    performance: { mean: 0.9, sd: 0.1 },
    span: { mean: 6.0, sd: 1.1 },
    accuracy: { mean: 0.95, sd: 0.07 },
    ruleTimeMs: { mean: 1000, sd: 250 },
  }),
  normal: freezeNorms({
    speed: { mean: 3.5, sd: 0.45 },
    performance: { mean: 0.88, sd: 0.1 },
    span: { mean: 5.5, sd: 1.1 },
    accuracy: { mean: 0.88, sd: 0.1 },
    ruleTimeMs: { mean: 1250, sd: 300 },
  }),
  hard: freezeNorms({
    speed: { mean: 3.2, sd: 0.45 },
    performance: { mean: 0.84, sd: 0.11 },
    span: { mean: 4.8, sd: 1.0 },
    accuracy: { mean: 0.8, sd: 0.12 },
    ruleTimeMs: { mean: 1500, sd: 350 },
  }),
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
/** A known level key, else the default (scoring never throws on a bad key; checkRun refuses it). */
const levelKey = (key) => (levelOf(key) ? key : DEFAULT_LEVEL);

/** Part 1. Mirrors the server's PVT measures, against the level's reaction norms. */
export function scoreReaction(reaction, level = DEFAULT_LEVEL) {
  const norms = LEVEL_NORMS[levelKey(level)];
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
  const zValue = 0.5 * z(speed, norms.speed) + 0.5 * z(performance, norms.performance);
  return { ...base, valid: true, speed: round(speed, 4), performance: round(performance, 4), score: toScore(zValue) };
}

/** Part 2. The longest row typed back right, against the level's span norm. */
export function scoreMemory(memory, level = DEFAULT_LEVEL) {
  const rounds = memory.rounds;
  const bestSpan = rounds.reduce((best, r) => (r.correct ? Math.max(best, r.length) : best), 0);
  const correct = rounds.filter((r) => r.correct).length;
  return { valid: true, bestSpan, correct, attempts: rounds.length, score: toScore(z(bestSpan, LEVEL_NORMS[levelKey(level)].span)) };
}

/** Part 3. Accuracy and the mean time of right answers (10 trials are too few for a switch cost), against the level's norms. */
export function scoreRules(rules, level = DEFAULT_LEVEL) {
  const key = levelKey(level);
  const norms = LEVEL_NORMS[key];
  const trials = rules.trials;
  const right = trials.filter((t) => t.correct && isNum(t.rtMs));
  const accuracy = trials.length ? right.length / trials.length : 0;
  const meanCorrectMs = right.length ? right.reduce((a, t) => a + t.rtMs, 0) / right.length : LEVELS[key].answerWindowMs;
  const zValue = 0.5 * z(accuracy, norms.accuracy) - 0.5 * z(meanCorrectMs, norms.ruleTimeMs);
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
 * overall = clamp(round(weighted part scores on the 100 +/- 15 scale + LEVEL_BONUS[level]), 40, 160).
 */
export function scoreRun(run) {
  const level = levelKey(run.level);
  const bonus = LEVEL_BONUS[level];
  const reaction = scoreReaction(run.reaction, level);
  const memory = scoreMemory(run.memory, level);
  const rules = scoreRules(run.rules, level);
  const valid = reaction.valid;
  const base =
    SCALE.mean +
    (WEIGHTS.reaction * (reaction.score - SCALE.mean) +
      WEIGHTS.memory * (memory.score - SCALE.mean) +
      WEIGHTS.rules * (rules.score - SCALE.mean)) /
      COMPOSITE_SD;
  const overall = valid ? clamp(round(base + bonus), SCALE.min, SCALE.max) : null;
  return {
    version: SCORING_VERSION,
    norms: NORMS_VERSION,
    level,
    bonus,
    valid,
    reason: valid ? null : reaction.reason,
    overall,
    reaction,
    memory,
    rules,
  };
}

/**
 * Checks that a raw run has the right shape and could have been played by a person at its level.
 * Returns null when it passes, or a short reason. The server runs this before scoring.
 */
export function checkRun(run) {
  if (!run || typeof run !== 'object' || run.v !== 2) return 'badVersion';
  const lv = levelOf(run.level);
  if (!lv) return 'badLevel';
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
  let length = lv.memoryStartLength;
  let missesAtLength = 0;
  let shownMs = 0;
  let ended = false;
  for (const row of m.rounds) {
    // No row can follow the end of the part (two misses at one length, or a right answer at the longest).
    if (ended) return 'impossibleMemory';
    if (!row || row.length !== length || typeof row.correct !== 'boolean') return 'impossibleMemory';
    shownMs += row.length * lv.memoryShowPerDigitMs;
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
  // The game always records every trial; one with no answer has answer null.
  if (!t || !Array.isArray(t.trials) || t.trials.length !== RULES.trials) return 'badRules';
  for (const trial of t.trials) {
    if (!trial || typeof trial !== 'object' || typeof trial.isSwitch !== 'boolean') return 'badRules';
    const { n, rule, pivot } = trial;
    if (!Number.isInteger(n) || n < lv.numberMin || n > lv.numberMax) return 'badRules';
    if (!lv.rules.includes(rule)) return 'badRules';
    if (rule === 'magnitude') {
      if (!Number.isInteger(pivot) || !lv.pivots.includes(pivot) || n === pivot) return 'badRules';
    } else if (pivot !== null) return 'badRules';
    if (trial.answer === null) {
      if (trial.correct !== false || trial.rtMs !== null) return 'badRules';
      continue;
    }
    if (!RULE_ANSWERS[rule].includes(trial.answer)) return 'badRules';
    if (!isNum(trial.rtMs) || trial.rtMs < RULES.fastestMs || trial.rtMs > lv.answerWindowMs) return 'impossibleRules';
    if (trial.correct !== (trial.answer === expectedAnswer(rule, n, pivot))) return 'badRules';
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
