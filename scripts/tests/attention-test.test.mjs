// Tests for the Attention Test engines, levels and scoring. Run: node --test "scripts/tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionRun, dotLayout, DOT_MARGIN } from '../../assets/js/attention-test/reaction.js';
import { MemoryRun } from '../../assets/js/attention-test/memory.js';
import { RulesRun, planSteps, rightAnswer, answerWord, ruleQuestion, ruleLabels, LONGEST_STREAK } from '../../assets/js/attention-test/rules.js';
import {
  REACTION, MEMORY, RULES, LEVELS, LEVEL_KEYS, DEFAULT_LEVEL, LEVEL_BONUS, SCORING_VERSION, NORMS_VERSION, WEIGHTS, COMPOSITE_SD,
  LEVEL_NORMS, scoreRun, scoreReaction, scoreMemory, scoreRules, checkRun,
} from '../../assets/js/attention-test/scoring.js';
import { shareUrl, shareText, cardData, cleanLevel, cleanFriendCode, loadFriendCode, FRIEND_CODE_KEY } from '../../assets/js/attention-test/share.js?v=3';
import { LAST_KEY, BEST_KEY, MAX_AGE_MS, saveRun, loadStored, readEntry, validEntry, canJoin, clearStored, agoText } from '../../assets/js/attention-test/stored.js';

/** A scripted random source: returns the values in turn, then repeats the last. */
const scripted = (...values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};
/** A small seeded PRNG (mulberry32) for long runs. */
const seeded = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- Reaction ----------

test('reaction: first dot is due 1 s + random x 3 s after the start', () => {
  const run = new ReactionRun(1000, scripted(0.5));
  assert.deepEqual(run.stage, { kind: 'waiting', dotDue: 1000 + 1000 + 1500 });
  assert.deepEqual(run.nextEvent, { kind: 'showDot', at: 3500 });
});

test('reaction: a dot shows on the first frame at or after it is due, timed from that frame', () => {
  const run = new ReactionRun(0, scripted(0)); // due at 1000
  assert.deepEqual(run.advance(990), []);
  assert.equal(run.stage.kind, 'waiting');
  assert.deepEqual(run.advance(1004.2), ['showDot']);
  assert.deepEqual(run.stage, { kind: 'dotShowing', shownAt: 1004.2 });
  const out = run.pressed(1254.26);
  assert.deepEqual(out, { kind: 'answered', ms: 250.1 });
  assert.deepEqual(run.reactionTimesMs, [250.1]);
  assert.deepEqual(run.feedback(1300), { kind: 'reaction', ms: 250.1 });
});

test('reaction: presses during the 1 s result are ignored; after it, a press while waiting is a false start', () => {
  const run = new ReactionRun(0, scripted(0, 1, 0)); // dot at 1000; next gap 4 s; then 1 s
  run.advance(1000);
  run.pressed(1300); // answered; next dot due 1300 + 4000
  assert.deepEqual(run.pressed(1500), { kind: 'ignored' }); // inside the result second
  assert.equal(run.falseStarts, 0);
  assert.deepEqual(run.pressed(2400), { kind: 'falseStart' });
  assert.equal(run.falseStarts, 1);
  assert.deepEqual(run.feedback(2500), { kind: 'tooEarly' });
  // The wait restarted from the false start: 1 s (random 0) + 2400.
  assert.deepEqual(run.stage, { kind: 'waiting', dotDue: 3400 });
  assert.equal(run.feedback(3400), null);
});

test('reaction: a dot with no answer times out after 30 s and records timeoutMs', () => {
  const run = new ReactionRun(0, scripted(0));
  run.advance(1000);
  assert.deepEqual(run.advance(30999), []);
  assert.deepEqual(run.advance(31010), ['timeOut']);
  assert.deepEqual(run.reactionTimesMs, [REACTION.timeoutMs]);
  assert.deepEqual(run.feedback(31100), { kind: 'missed' });
  // The next wait starts at the timeout moment, not at the frame.
  assert.deepEqual(run.stage, { kind: 'waiting', dotDue: 32000 });
});

test('reaction: the run ends hard at 45 s and a dot still showing is dropped', () => {
  const run = new ReactionRun(0, scripted(0));
  // Answer every dot 300 ms after it shows until a dot is up at the end.
  let t = 0;
  while (!run.isOver) {
    t += 10;
    run.advance(t);
    if (run.stage.kind === 'dotShowing' && t - run.stage.shownAt >= 300 && t < 43_000) run.pressed(t);
  }
  assert.ok(t >= 45_000 && t < 45_020);
  const shown = run.dotsShown;
  assert.equal(run.stage.kind, "over");
  assert.equal(run.reactionTimesMs.length, shown - 1, 'the last dot (shown, never answered) is dropped');
  assert.deepEqual(run.pressed(45_100), { kind: 'ignored' });
  assert.equal(run.nextEvent, null);
});

test('reaction: a dot due before the end but drawn after it never shows', () => {
  const run = new ReactionRun(0, scripted(0));
  run.stage = { kind: 'waiting', dotDue: 44_995 };
  assert.deepEqual(run.advance(45_010), ['reachEnd']);
  assert.equal(run.dotsShown, 0);
  assert.ok(run.isOver);
});

test('reaction: a press after 30 s counts as the timeout, not an answer', () => {
  const run = new ReactionRun(0, scripted(0));
  run.advance(1000);
  assert.deepEqual(run.pressed(31_500), { kind: 'ignored' });
  assert.deepEqual(run.reactionTimesMs, [REACTION.timeoutMs]);
});

test('reaction: dotLayout per level keeps the whole dot inside, with the margin', () => {
  const areas = [{ width: 600, height: 380 }, { width: 330, height: 196 }, { width: 120, height: 90 }];
  for (const key of LEVEL_KEYS) {
    const dot = LEVELS[key].reactionDot;
    for (const area of areas) {
      const random = seeded(17);
      const lefts = new Set();
      for (let i = 0; i < 200; i += 1) {
        const box = dotLayout(area, dot, random);
        assert.ok(box.size > 0 && box.size <= dot.sizePx, `${key} size ${box.size}`);
        assert.ok(box.left >= DOT_MARGIN && box.top >= DOT_MARGIN, `${key} ${JSON.stringify(box)}`);
        assert.ok(box.left + box.size <= area.width - DOT_MARGIN, `${key} right edge ${JSON.stringify(box)} in ${area.width}`);
        assert.ok(box.top + box.size <= area.height - DOT_MARGIN, `${key} bottom edge ${JSON.stringify(box)} in ${area.height}`);
        lefts.add(box.left);
      }
      if (dot.position === 'center') assert.equal(lefts.size, 1, `${key}: a centred dot never moves`);
      else if (area.width > 200) assert.ok(lefts.size > 50, `${key}: a random dot moves (${lefts.size} spots)`);
    }
  }
});

test('reaction: dotLayout sizes, centring, clamping and the random extremes', () => {
  assert.deepEqual(dotLayout({ width: 400, height: 300 }, LEVELS.easy.reactionDot), { size: 140, left: 130, top: 80 });
  // A small phone pad clamps the Easy dot to fit: 120 x 100 leaves 84 px.
  assert.deepEqual(dotLayout({ width: 120, height: 100 }, LEVELS.easy.reactionDot), { size: 84, left: 18, top: 8 });
  assert.deepEqual(dotLayout({ width: 400, height: 300 }, LEVELS.hard.reactionDot, () => 0), { size: 56, left: 8, top: 8 });
  assert.deepEqual(dotLayout({ width: 400, height: 300 }, LEVELS.hard.reactionDot, () => 1), { size: 56, left: 336, top: 236 });
  assert.deepEqual(dotLayout({ width: 400, height: 300 }, LEVELS.normal.reactionDot, () => 0.5), { size: 96, left: 152, top: 102 });
  // A broken source or an area with no room never throws or leaves the area.
  assert.deepEqual(dotLayout({ width: 400, height: 300 }, LEVELS.hard.reactionDot, () => NaN), { size: 56, left: 8, top: 8 });
  assert.deepEqual(dotLayout({ width: 10, height: 10 }, LEVELS.hard.reactionDot, () => 0.7), { size: 0, left: 8, top: 8 });
});

test('reaction: the same times score higher against harder levels (per-level reaction norms)', () => {
  const reaction = { durationSeconds: 45, reactionTimesMs: Array(15).fill(300), falseStarts: 0 };
  const [e, n, h] = LEVEL_KEYS.map((k) => scoreReaction(reaction, k));
  assert.ok(e.score < n.score && n.score < h.score, `${e.score} ${n.score} ${h.score}`);
  assert.equal(e.speed, n.speed, 'the raw measures do not change with the level');
  assert.equal(scoreReaction(reaction).score, n.score, 'no level means Normal');
});

// ---------- Memory ----------

/** A random source that yields the digits given (digit d -> d / 10 + 0.05). */
const digitSource = (digits) => scripted(...digits.map((d) => d / 10 + 0.05));

test('memory: a row of 3 shows for 3 s, then hides for typing', () => {
  const run = new MemoryRun(0, digitSource([4, 4, 7, 1]));
  assert.deepEqual(run.digits, [4, 7, 1], 'a digit equal to the one before is re-drawn');
  assert.equal(run.phase, 'showing');
  assert.equal(run.type(4, 100), null, 'no typing while the row shows');
  run.advance(2999);
  assert.equal(run.phase, 'showing');
  run.advance(3000);
  assert.equal(run.phase, 'entering');
});

test('memory: backspace, right answer, feedback 0.8 s, then a longer row', () => {
  const run = new MemoryRun(0, digitSource([1, 2, 3, 5, 6, 7, 8]));
  run.advance(3000);
  run.type(1, 3100);
  run.type(9, 3200);
  assert.equal(run.deleteLast(3300), true);
  assert.deepEqual(run.entered, [1]);
  run.type(2, 3400);
  assert.equal(run.type(3, 3500), true);
  assert.equal(run.phase, 'feedback');
  assert.equal(run.type(5, 3600), null, 'keys during the feedback are ignored');
  run.advance(4299);
  assert.equal(run.phase, 'feedback');
  run.advance(4300);
  assert.equal(run.phase, 'showing');
  assert.equal(run.digits.length, 4);
  assert.deepEqual(run.digits, [5, 6, 7, 8]);
  run.advance(4300 + 4000);
  assert.equal(run.phase, 'entering');
  assert.deepEqual(run.result().rounds, [{ length: 3, correct: true }]);
});

test('memory: two wrong answers at the same length finish', () => {
  const run = new MemoryRun(0, seeded(7));
  let t = 0;
  const wrong = () => {
    t = run.phaseEnds;
    run.advance(t);
    const d = run.digits;
    for (let i = 0; i < d.length; i += 1) run.type(i === 0 ? (d[0] + 1) % 10 : d[i], (t += 100));
  };
  wrong();
  assert.equal(run.lastAnswer.correct, false);
  run.advance((t += 800));
  assert.equal(run.phase, 'showing');
  assert.equal(run.digits.length, 3, 'a miss keeps the length');
  wrong();
  run.advance((t += 800));
  assert.ok(run.isFinished);
  assert.deepEqual(run.result().rounds, [
    { length: 3, correct: false },
    { length: 3, correct: false },
  ]);
});

test('memory: a miss then a right answer resets the misses', () => {
  const run = new MemoryRun(0, seeded(3));
  let t = 0;
  const answer = (right) => {
    t = run.phaseEnds;
    run.advance(t);
    const d = run.digits;
    for (let i = 0; i < d.length; i += 1) run.type(!right && i === 0 ? (d[0] + 1) % 10 : d[i], (t += 50));
    run.advance((t += 800));
  };
  answer(false);
  answer(true);
  answer(false);
  assert.ok(!run.isFinished, 'one miss at 3 and one at 4 do not finish');
  assert.deepEqual(run.result().rounds.map((r) => r.length), [3, 3, 4]);
});

test('memory: a right answer at 9 digits finishes (with time to spare on a fast clock)', () => {
  // Use a run whose clock is frozen at the start so 45 s never passes; checks the ending rule only.
  const run = new MemoryRun(0, seeded(11));
  run.end = Infinity;
  let t = 0;
  while (!run.isFinished) {
    t = run.phaseEnds;
    run.advance(t);
    for (const d of run.digits) run.type(d, (t += 10));
    run.advance((t += 800));
  }
  assert.deepEqual(run.result().rounds.map((r) => r.length), [3, 4, 5, 6, 7, 8, 9]);
  assert.ok(run.result().rounds.every((r) => r.correct));
});

test('memory: at 45 s a half-typed row is dropped, answered rows stay', () => {
  const run = new MemoryRun(0, seeded(5));
  let t = 0;
  while (t < 40_000) {
    t = run.phaseEnds;
    run.advance(t);
    for (const d of run.digits) run.type(d, (t += 200));
    run.advance((t += 800));
  }
  const answered = run.rounds.length;
  t = run.phaseEnds;
  run.advance(t);
  if (run.phase === 'entering') run.type(run.digits[0], t + 10);
  run.advance(45_000);
  assert.ok(run.isFinished);
  assert.equal(run.result().rounds.length, answered);
  assert.equal(run.remaining(45_000), 0);
});

test('memory: rows never hold the same digit twice in a row', () => {
  const run = new MemoryRun(0, () => 0.3); // a stuck source
  assert.deepEqual(run.digits, [3, 4, 3]);
});

// ---------- Memory: show time per level ----------

test('memory: the first row length and the show time per digit come from the level', () => {
  for (const key of LEVEL_KEYS) {
    const run = new MemoryRun(0, digitSource([1, 2, 3, 4]), key);
    const ms = LEVELS[key].memoryShowPerDigitMs;
    const len = LEVELS[key].memoryStartLength;
    assert.equal(run.digits.length, len, key);
    assert.equal(run.phaseEnds, len * ms, key);
    run.advance(len * ms - 1);
    assert.equal(run.phase, 'showing', key);
    run.advance(len * ms);
    assert.equal(run.phase, 'entering', key);
  }
  assert.equal(new MemoryRun(0, seeded(1), 'hard').digits.length, 4);
  assert.equal(new MemoryRun(0, seeded(1), 'easy').digits.length, 3);
  assert.equal(new MemoryRun(0, digitSource([1, 2, 3])).phaseEnds, 3000, 'no level means Normal');
  assert.equal(new MemoryRun(0, digitSource([1, 2, 3]), 'nope').phaseEnds, 3000, 'an unknown level means Normal');
});

// ---------- Rules ----------

test('levels: the exported contract', () => {
  assert.deepEqual(LEVEL_KEYS, ['easy', 'normal', 'hard']);
  assert.equal(DEFAULT_LEVEL, 'normal');
  assert.ok(Object.isFrozen(LEVELS) && Object.isFrozen(LEVELS.hard) && Object.isFrozen(LEVELS.hard.pivots));
  assert.ok(Object.isFrozen(LEVELS.easy.reactionDot) && Object.isFrozen(LEVEL_NORMS.hard.speed));
  assert.deepEqual(LEVELS.easy, {
    label: 'Easy', reactionDot: { sizePx: 140, position: 'center' }, memoryStartLength: 3, memoryShowPerDigitMs: 1200,
    rules: ['parity', 'magnitude'], pivots: [5], numberMin: 1, numberMax: 9, answerWindowMs: 4000,
  });
  assert.deepEqual(LEVELS.normal, {
    label: 'Normal', reactionDot: { sizePx: 96, position: 'random' }, memoryStartLength: 3, memoryShowPerDigitMs: 1000,
    rules: ['parity', 'magnitude', 'multiple3'], pivots: [3, 4, 5, 6, 7], numberMin: 1, numberMax: 9, answerWindowMs: 3000,
  });
  assert.deepEqual(LEVELS.hard, {
    label: 'Hard', reactionDot: { sizePx: 56, position: 'random' }, memoryStartLength: 4, memoryShowPerDigitMs: 750,
    rules: ['parity', 'magnitude', 'multiple3'], pivots: [25, 40, 50, 60, 75], numberMin: 12, numberMax: 98, answerWindowMs: 2500,
  });
  assert.deepEqual(LEVEL_NORMS.easy.speed, { mean: 3.7, sd: 0.45 });
  assert.deepEqual(LEVEL_NORMS.normal.performance, { mean: 0.88, sd: 0.1 });
  assert.deepEqual(LEVEL_NORMS.hard.performance, { mean: 0.84, sd: 0.11 });
  assert.deepEqual({ ...LEVEL_BONUS }, { easy: -10, normal: 0, hard: 10 });
  assert.equal(SCORING_VERSION, 2);
  assert.equal(NORMS_VERSION, 'beta-2');
});

test('rules: plans per level stay in range, use only the level rules and pivots, and never show the pivot', () => {
  for (const key of LEVEL_KEYS) {
    const lv = LEVELS[key];
    const seenRules = new Set();
    const seenPivots = new Set();
    for (let seed = 1; seed <= 300; seed += 1) {
      const steps = planSteps(key, seeded(seed), 40);
      assert.equal(steps[0].isSwitch, false);
      let streak = 0;
      let kind = null;
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        assert.ok(Number.isInteger(s.n) && s.n >= lv.numberMin && s.n <= lv.numberMax, `${key} n ${s.n}`);
        assert.ok(lv.rules.includes(s.rule), `${key} rule ${s.rule}`);
        seenRules.add(s.rule);
        if (s.rule === 'magnitude') {
          assert.ok(lv.pivots.includes(s.pivot), `${key} pivot ${s.pivot}`);
          assert.notEqual(s.n, s.pivot);
          seenPivots.add(s.pivot);
        } else {
          assert.equal(s.pivot, null);
        }
        if (i === 0) continue;
        assert.notEqual(s.n, steps[i - 1].n, `${key} seed ${seed}: the same number twice in a row at ${i}`);
        assert.equal(s.isSwitch, s.rule !== steps[i - 1].rule);
        streak = s.isSwitch === kind ? streak + 1 : 1;
        kind = s.isSwitch;
        assert.ok(streak <= LONGEST_STREAK, `${key} seed ${seed}: streak ${streak} at ${i}`);
      }
    }
    assert.deepEqual([...seenRules].sort(), [...lv.rules].sort(), `${key}: every rule shows up`);
    assert.deepEqual([...seenPivots].sort((a, b) => a - b), [...lv.pivots], `${key}: every pivot shows up`);
  }
});

test('rules: roughly half the steps switch, and Normal is not stuck on 5', () => {
  let switches = 0;
  let steps = 0;
  let pivot5 = 0;
  let magnitude = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const plan = planSteps('normal', seeded(seed));
    switches += plan.filter((s) => s.isSwitch).length;
    steps += plan.length - 1;
    for (const s of plan) {
      if (s.rule === 'magnitude') {
        magnitude += 1;
        if (s.pivot === 5) pivot5 += 1;
      }
    }
  }
  assert.ok(switches / steps > 0.4 && switches / steps < 0.65, `switch share ${switches / steps}`);
  assert.ok(pivot5 / magnitude < 0.35, `pivot 5 share ${pivot5 / magnitude}`);
});

test('rules: a coin that always says switch is flipped after 3 (Easy, two rules)', () => {
  // A source stuck at 0.1: the first rule is parity and every coin says switch.
  const steps = planSteps('easy', () => 0.1, 10);
  assert.deepEqual(steps.map((s) => s.isSwitch), [false, true, true, true, false, true, true, true, false, true]);
  assert.equal(steps[0].rule, 'parity');
});

test('rules: a stuck random source still gives valid numbers', () => {
  for (const key of LEVEL_KEYS) {
    const lv = LEVELS[key];
    for (const v of [0, 0.5, 0.999999]) {
      const steps = planSteps(key, () => v, 10);
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        assert.ok(s.n >= lv.numberMin && s.n <= lv.numberMax);
        if (s.rule === 'magnitude') assert.notEqual(s.n, s.pivot);
        if (i) assert.notEqual(s.n, steps[i - 1].n);
      }
    }
  }
});

test('rules: questions, labels, answers and words', () => {
  assert.equal(ruleQuestion('parity'), 'Odd or even?');
  assert.equal(ruleQuestion('magnitude', 40), 'Lower or higher than 40?');
  assert.equal(ruleQuestion('multiple3'), 'Multiple of 3?');
  assert.deepEqual({ ...ruleLabels('multiple3') }, { left: 'Yes', right: 'No' });
  assert.deepEqual({ ...ruleLabels('magnitude') }, { left: 'Lower', right: 'Higher' });
  assert.equal(rightAnswer('parity', 3), 'odd');
  assert.equal(rightAnswer('parity', 48), 'even');
  assert.equal(rightAnswer('magnitude', 6, 5), 'higher');
  assert.equal(rightAnswer('magnitude', 6, 7), 'lower');
  assert.equal(rightAnswer('magnitude', 39, 40), 'lower');
  assert.equal(rightAnswer('multiple3', 9), 'yes');
  assert.equal(rightAnswer('multiple3', 51), 'yes');
  assert.equal(rightAnswer('multiple3', 52), 'no');
  assert.equal(answerWord('magnitude', 'left'), 'lower');
  assert.equal(answerWord('multiple3', 'left'), 'yes');
  assert.equal(answerWord('multiple3', 'right'), 'no');
});

test('rules: answers, too-fast presses and timeouts', () => {
  const steps = [
    { rule: 'parity', n: 3, pivot: null, isSwitch: false },
    { rule: 'magnitude', n: 8, pivot: 6, isSwitch: true },
    { rule: 'multiple3', n: 2, pivot: null, isSwitch: true },
  ];
  const run = new RulesRun(steps, 1000, 'normal');
  assert.equal(run.answered('left', 1100), null, 'faster than 150 ms is ignored');
  const t1 = run.answered('left', 1800.04);
  assert.deepEqual(t1, { n: 3, rule: 'parity', pivot: null, isSwitch: false, answer: 'odd', correct: true, rtMs: 800 });
  assert.equal(run.current, null, 'blank between numbers');
  assert.equal(run.answered('right', 1900), null);
  assert.deepEqual(run.advance(2299), []);
  assert.deepEqual(run.advance(2305), ['nextDigit']);
  assert.equal(run.current.n, 8);
  run.answered('left', 3000); // lower than 6: wrong
  assert.deepEqual(run.trials[1], { n: 8, rule: 'magnitude', pivot: 6, isSwitch: true, answer: 'lower', correct: false, rtMs: 695 });
  run.advance(3500);
  assert.deepEqual(run.advance(6499), []);
  assert.deepEqual(run.advance(6500), ['timeOut']);
  assert.deepEqual(run.trials[2], { n: 2, rule: 'multiple3', pivot: null, isSwitch: true, answer: null, correct: false, rtMs: null });
  assert.ok(run.isOver);
});

test('rules: the answer window comes from the level', () => {
  const step = [{ rule: 'multiple3', n: 21, pivot: null, isSwitch: false }];
  for (const key of LEVEL_KEYS) {
    const w = LEVELS[key].answerWindowMs;
    const late = new RulesRun(step, 0, key);
    assert.deepEqual(late.nextEvent, { kind: 'timeOut', at: w });
    assert.deepEqual(late.advance(w - 1), [], key);
    assert.deepEqual(late.advance(w), ['timeOut'], key);
    const inTime = new RulesRun(step, 0, key);
    const t = inTime.answered('left', w - 1);
    assert.equal(t.answer, 'yes');
    assert.equal(t.correct, true);
    const tooLate = new RulesRun(step, 0, key);
    assert.equal(tooLate.answered('left', w), null, 'a press at the window end counts as the timeout');
    assert.equal(tooLate.trials[0].answer, null);
  }
});

// ---------- Full scripted runs ----------

/** Plays a whole run at a level with scripted presses and returns the raw run. */
function playRun(level, seed, { rulesRtMs = 900 } = {}) {
  const random = seeded(seed);
  // Reaction: answer each dot 260-320 ms after it shows, with one false start.
  const reaction = new ReactionRun(0, random);
  let t = 0;
  let fs = false;
  let delay = 260;
  while (!reaction.isOver) {
    t += 16.7;
    reaction.advance(t);
    if (reaction.stage.kind === 'dotShowing' && t - reaction.stage.shownAt >= delay) {
      reaction.pressed(t);
      delay = 260 + ((reaction.reactionTimesMs.length * 7) % 60);
    } else if (!fs && t > 10_000 && reaction.stage.kind === 'waiting' && reaction.feedback(t) === null) {
      reaction.pressed(t);
      fs = true;
    }
  }
  // Memory: right up to 6 digits, then wrong twice.
  const memory = new MemoryRun(100_000, random, level);
  t = 100_000;
  while (!memory.isFinished) {
    t = Math.max(t, memory.phaseEnds ?? t);
    memory.advance(t);
    if (memory.isFinished) break;
    const d = memory.digits;
    const right = d.length < 7;
    for (let i = 0; i < d.length; i += 1) memory.type(!right && i === 0 ? (d[0] + 1) % 10 : d[i], (t += 250));
    t += MEMORY.feedbackMs;
    memory.advance(t);
  }
  // Rules: answer right, except the 4th runs out and the 7th is wrong.
  const rules = new RulesRun(planSteps(level, random), 200_000, level);
  t = 200_000;
  let n = 0;
  while (!rules.isOver) {
    if (rules.current) {
      n += 1;
      const step = rules.current;
      if (n === 4) {
        t += LEVELS[level].answerWindowMs;
        rules.advance(t);
      } else {
        const want = rightAnswer(step.rule, step.n, step.pivot);
        const correctSide = answerWord(step.rule, 'left') === want ? 'left' : 'right';
        const side = n === 7 ? (correctSide === 'left' ? 'right' : 'left') : correctSide;
        rules.answered(side, (t += rulesRtMs));
      }
    }
    t += RULES.blankMs;
    rules.advance(t);
  }
  return { v: 2, level, device: 'computer', reaction: reaction.result(), memory: memory.result(), rules: rules.result() };
}

for (const level of ['easy', 'normal', 'hard']) {
  test(`a full scripted run on ${level} passes checkRun and scoreRun`, () => {
    const run = playRun(level, 42);
    assert.equal(checkRun(run), null);
    const result = scoreRun(run);
    assert.equal(result.valid, true);
    assert.equal(result.level, level);
    assert.equal(result.bonus, LEVEL_BONUS[level]);
    assert.equal(result.version, 2);
    assert.equal(result.norms, 'beta-2');
    assert.ok(result.overall >= 40 && result.overall <= 160);
    assert.equal(result.reaction.falseStarts, 1);
    assert.equal(result.memory.bestSpan, 6);
    assert.equal(result.rules.correct, 8);
    assert.equal(result.rules.total, 10);
    assert.ok(result.reaction.answers >= 8);
    const lv = LEVELS[level];
    for (const trial of run.rules.trials) {
      assert.ok(trial.n >= lv.numberMin && trial.n <= lv.numberMax);
      assert.ok(lv.rules.includes(trial.rule));
    }
  });
}

test('the same play scores lower part scores on an easier level (per-level norms)', () => {
  const memory = { rounds: [3, 4, 5, 6].map((length) => ({ length, correct: true })) };
  assert.ok(scoreMemory(memory, 'easy').score < scoreMemory(memory, 'normal').score);
  assert.ok(scoreMemory(memory, 'normal').score < scoreMemory(memory, 'hard').score);
  const trials = Array.from({ length: 10 }, () => ({ correct: true, rtMs: 1100 }));
  assert.ok(scoreRules({ trials }, 'easy').score < scoreRules({ trials }, 'normal').score);
  assert.ok(scoreRules({ trials }, 'normal').score < scoreRules({ trials }, 'hard').score);
  // A typical player at a level scores 100 on that part.
  assert.equal(scoreMemory({ rounds: [{ length: 3, correct: true }, { length: 4, correct: true }, { length: 5, correct: true }, { length: 6, correct: true }] }, 'easy').score, 100);
  // No right answers: the mean time is the level's window.
  assert.equal(scoreRules({ trials: Array.from({ length: 10 }, () => ({ correct: false, rtMs: null })) }, 'hard').meanCorrectMs, 2500);
});

test('the level bonus moves the overall score only, then it is clamped to 40-160', () => {
  const base = playRun('normal', 42);
  const normal = scoreRun(base);
  // The same raw parts under each level: overall = clamp(round(weighted part scores + bonus)).
  for (const level of LEVEL_KEYS) {
    const r = scoreRun({ ...base, level });
    const expected =
      100 +
      (WEIGHTS.reaction * (r.reaction.score - 100) + WEIGHTS.memory * (r.memory.score - 100) + WEIGHTS.rules * (r.rules.score - 100)) / COMPOSITE_SD;
    assert.equal(r.overall, Math.min(160, Math.max(40, Math.round(expected + LEVEL_BONUS[level]))), level);
  }
  assert.equal(normal.bonus, 0);
  // Part scores carry no bonus; the same reaction times score higher against Hard's slower norms.
  assert.ok(scoreRun({ ...base, level: 'hard' }).reaction.score > normal.reaction.score);
  assert.ok(scoreRun({ ...base, level: 'easy' }).reaction.score < normal.reaction.score);
  // Clamping: a top run on Hard stays at 160; a bottom run on Easy stays at 40.
  const best = playRun('hard', 7, { rulesRtMs: 400 });
  best.memory = { rounds: [4, 5, 6, 7, 8, 9].map((length) => ({ length, correct: true })) };
  best.rules.trials = best.rules.trials.map((t) => (t.answer === null || !t.correct
    ? { ...t, answer: rightAnswer(t.rule, t.n, t.pivot), correct: true, rtMs: 400 }
    : { ...t, rtMs: 400 }));
  best.reaction = { durationSeconds: 45, reactionTimesMs: Array(30).fill(160), falseStarts: 0 };
  assert.equal(checkRun(best), null);
  const top = scoreRun(best);
  assert.equal(top.overall, 160);
  assert.equal(top.bonus, 10);
  const worst = playRun('easy', 7);
  worst.memory = { rounds: [{ length: 3, correct: false }, { length: 3, correct: false }] };
  worst.rules.trials = worst.rules.trials.map((t) => ({ ...t, answer: null, correct: false, rtMs: null }));
  worst.reaction = { durationSeconds: 45, reactionTimesMs: Array(10).fill(900), falseStarts: 2 };
  assert.equal(checkRun(worst), null);
  const bottom = scoreRun(worst);
  assert.equal(bottom.valid, true);
  assert.equal(bottom.overall, 40);
  assert.equal(bottom.bonus, -10);
});

// ---------- checkRun per level ----------

/** A valid hand-made run at a level; `trial` overrides the first rules trial. */
function handRun(level, trial = {}) {
  const run = playRun(level, 11);
  run.rules.trials[0] = { ...run.rules.trials[0], ...trial };
  return run;
}

test('checkRun: version and level', () => {
  const run = playRun('normal', 3);
  assert.equal(checkRun(run), null);
  assert.equal(checkRun({ ...run, v: 1 }), 'badVersion');
  assert.equal(checkRun({ ...run, level: undefined }), 'badLevel');
  assert.equal(checkRun({ ...run, level: 'Hard' }), 'badLevel');
  assert.equal(checkRun({ ...run, level: 'expert' }), 'badLevel');
});

test('checkRun: a rule that is not in the level is refused', () => {
  assert.equal(checkRun(handRun('easy', { rule: 'multiple3', n: 6, pivot: null, answer: 'yes', correct: true, rtMs: 900 })), 'badRules');
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 6, pivot: null, answer: 'yes', correct: true, rtMs: 900 })), null);
  assert.equal(checkRun(handRun('normal', { rule: 'prime', n: 6, pivot: null, answer: 'yes', correct: true, rtMs: 900 })), 'badRules');
});

test('checkRun: pivots must belong to the level, differ from n, and be null for other rules', () => {
  const mag = (n, pivot, answer) => ({ rule: 'magnitude', n, pivot, answer, correct: answer === (n < pivot ? 'lower' : 'higher'), rtMs: 900 });
  assert.equal(checkRun(handRun('easy', mag(3, 5, 'lower'))), null);
  assert.equal(checkRun(handRun('easy', mag(3, 6, 'lower'))), 'badRules', 'pivot 6 is not an Easy pivot');
  assert.equal(checkRun(handRun('normal', mag(3, 6, 'lower'))), null);
  assert.equal(checkRun(handRun('normal', mag(6, 6, 'higher'))), 'badRules', 'n equal to the pivot');
  assert.equal(checkRun(handRun('normal', mag(3, 50, 'lower'))), 'badRules', 'pivot 50 is a Hard pivot');
  assert.equal(checkRun(handRun('hard', mag(30, 50, 'lower'))), null);
  assert.equal(checkRun(handRun('hard', mag(30, 5, 'higher'))), 'badRules');
  assert.equal(checkRun(handRun('hard', mag(30, null, 'higher'))), 'badRules');
  assert.equal(checkRun(handRun('hard', { rule: 'parity', n: 30, pivot: 50, answer: 'even', correct: true, rtMs: 900 })), 'badRules');
});

test('checkRun: n must be in the level range', () => {
  const par = (n) => ({ rule: 'parity', n, pivot: null, answer: n % 2 ? 'odd' : 'even', correct: true, rtMs: 900 });
  assert.equal(checkRun(handRun('easy', par(9))), null);
  assert.equal(checkRun(handRun('easy', par(12))), 'badRules');
  assert.equal(checkRun(handRun('easy', par(0))), 'badRules');
  assert.equal(checkRun(handRun('normal', par(10))), 'badRules');
  assert.equal(checkRun(handRun('hard', par(12))), null);
  assert.equal(checkRun(handRun('hard', par(98))), null);
  assert.equal(checkRun(handRun('hard', par(9))), 'badRules');
  assert.equal(checkRun(handRun('hard', par(99))), 'badRules');
  assert.equal(checkRun(handRun('hard', { ...par(30), n: 30.5 })), 'badRules');
});

test('checkRun: answer times must fit the level window', () => {
  const t = (rtMs) => ({ rule: 'parity', n: 14, pivot: null, answer: 'even', correct: true, rtMs });
  assert.equal(checkRun(handRun('hard', t(2500))), null);
  assert.equal(checkRun(handRun('hard', t(2600))), 'impossibleRules');
  assert.equal(checkRun(handRun('normal', { ...t(3000), n: 4 })), null);
  assert.equal(checkRun(handRun('normal', { ...t(3500), n: 4 })), 'impossibleRules');
  assert.equal(checkRun(handRun('easy', { ...t(3900), n: 4 })), null);
  assert.equal(checkRun(handRun('easy', { ...t(4100), n: 4 })), 'impossibleRules');
  assert.equal(checkRun(handRun('easy', { ...t(100), n: 4 })), 'impossibleRules', 'faster than 150 ms');
});

test('checkRun: answers must match the rule and correctness must be consistent', () => {
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 7, pivot: null, answer: 'no', correct: true, rtMs: 900 })), null);
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 7, pivot: null, answer: 'no', correct: false, rtMs: 900 })), 'badRules');
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 7, pivot: null, answer: 'odd', correct: false, rtMs: 900 })), 'badRules');
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 7, pivot: null, answer: null, correct: false, rtMs: null })), null);
  assert.equal(checkRun(handRun('normal', { rule: 'multiple3', n: 7, pivot: null, answer: null, correct: false, rtMs: 500 })), 'badRules');
  assert.equal(checkRun(handRun('normal', { isSwitch: 'yes' })), 'badRules');
  const short = playRun('normal', 3);
  short.rules.trials.pop();
  assert.equal(checkRun(short), 'badRules', 'exactly 10 trials');
});

test('checkRun: memory rows use the level start length and show time', () => {
  // 3..9 all right then nothing: 42 digits shown. At 1.2 s that is 50.4 s > 46 s (impossible on Easy);
  // at 1 s it is 42 s (fine on Normal). Hard starts at 4 digits, so a first row of 3 is refused there.
  const rows = (from) => [3, 4, 5, 6, 7, 8, 9].filter((l) => l >= from).map((length) => ({ length, correct: true }));
  for (const [level, from, want] of [
    ['easy', 3, 'impossibleMemory'],
    ['normal', 3, null],
    ['hard', 3, 'impossibleMemory'],
    ['hard', 4, null],
    ['normal', 4, 'impossibleMemory'],
    ['easy', 4, 'impossibleMemory'],
  ]) {
    const run = playRun(level, 5);
    run.memory = { rounds: rows(from) };
    assert.equal(checkRun(run), want, `${level} from ${from}`);
  }
  const easyShort = playRun('easy', 5);
  easyShort.memory = { rounds: rows(3).slice(0, 5) }; // 3..7: 25 digits x 1.2 s = 30 s
  assert.equal(checkRun(easyShort), null);
  const ended = playRun('hard', 5);
  ended.memory = { rounds: [{ length: 4, correct: false }, { length: 4, correct: false }, { length: 4, correct: true }] };
  assert.equal(checkRun(ended), 'impossibleMemory', 'no row after the part ended');
});

test('a run with too few answers is valid in shape but not scorable', () => {
  const reaction = new ReactionRun(0, () => 0.5);
  let t = 0;
  while (!reaction.isOver) reaction.advance((t += 20)); // never presses: dots time out
  // Rules: every number runs out (a complete 10-trial part, as checkRun requires).
  const rules = new RulesRun(planSteps('hard', seeded(9)), 0, 'hard');
  for (let t2 = 0; !rules.isOver; t2 += 100) rules.advance(t2);
  assert.equal(rules.trials.length, RULES.trials);
  const run = { v: 2, level: 'hard', device: 'phone', reaction: reaction.result(), memory: { rounds: [] }, rules: rules.result() };
  assert.equal(checkRun(run), null);
  const result = scoreRun(run);
  assert.equal(result.valid, false);
  assert.equal(result.overall, null);
  assert.equal(result.reason, 'tooFewAnswers');
  assert.ok(reaction.reactionTimesMs.every((ms) => ms === REACTION.timeoutMs));
});

test('shareUrl: challenge links with and without name and friend code', () => {
  const base = 'https://adarna.us/attention-test/s/118';
  assert.equal(shareUrl(118), base);
  assert.equal(shareUrl(118, ''), base);
  assert.equal(shareUrl(118, 'Priya'), `${base}?by=Priya`);
  assert.equal(shareUrl(118, 'Priya', 'abcd2345'), `${base}?by=Priya&f=abcd2345`);
  assert.equal(shareUrl(118, '', 'abcd2345'), `${base}?f=abcd2345`);
  assert.equal(shareUrl(118, 'Ana Lu & Co', 'zzzz9999'), `${base}?by=Ana%20Lu%20%26%20Co&f=zzzz9999`);
});

test('shareUrl: an invalid friend code is dropped', () => {
  const base = 'https://adarna.us/attention-test/s/118';
  for (const bad of ['BAD!', 'ABCD2345', 'abcd234', 'abcd23456', 'abcd1234', 'abcdo234', 'abcdl234', 'abcdi234', ' abcd2345', null, undefined, 12345678]) {
    assert.equal(cleanFriendCode(bad), '', String(bad));
    assert.equal(shareUrl(118, 'Priya', bad), `${base}?by=Priya`, String(bad));
    assert.equal(shareUrl(118, '', bad), base, String(bad));
  }
});

test('loadFriendCode reads localStorage at call time and survives missing or broken storage', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const set = (value) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
  try {
    const store = new Map();
    set({ getItem: (k) => (store.has(k) ? store.get(k) : null) });
    assert.equal(loadFriendCode(), '');
    store.set(FRIEND_CODE_KEY, 'abcd2345');
    assert.equal(loadFriendCode(), 'abcd2345');
    store.set(FRIEND_CODE_KEY, 'BAD!');
    assert.equal(loadFriendCode(), '');
    set({ getItem: () => { throw new Error('blocked'); } });
    assert.equal(loadFriendCode(), '');
    set(undefined);
    assert.equal(loadFriendCode(), '');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

test('shareUrl carries the level, leaving out normal and anything unknown', () => {
  const base = 'https://adarna.us/attention-test/s/118';
  assert.equal(shareUrl(118, 'Priya', 'abcd2345', 'hard'), `${base}?by=Priya&f=abcd2345&l=hard`);
  assert.equal(shareUrl(118, '', '', 'easy'), `${base}?l=easy`);
  assert.equal(shareUrl(118, 'Priya', 'abcd2345', 'normal'), `${base}?by=Priya&f=abcd2345`);
  assert.equal(shareUrl(118, 'Priya'), `${base}?by=Priya`);
  for (const bad of ['HARD', 'bad', '__proto__', { toString: () => 'hard' }, null]) {
    assert.equal(shareUrl(118, '', '', bad), base);
  }
  assert.equal(shareUrl(118, '', 'bad-code', 'hard'), `${base}?l=hard`);
});

test('cleanLevel keeps only the three level keys', () => {
  for (const ok of ['easy', 'normal', 'hard']) assert.equal(cleanLevel(ok), ok);
  for (const bad of [undefined, '', 'Hard', 'constructor']) assert.equal(cleanLevel(bad), 'normal');
});

test('share text and card data name the level and bonus', () => {
  assert.ok(shareText(118, 'hard').startsWith('I scored 118 on Hard on the Clarus Attention Test'));
  assert.ok(shareText(118).includes('on Normal'));
  const hard = cardData({ valid: true, overall: 128, bonus: 10, level: 'hard' }, 'Priya');
  assert.equal(hard.level, 'hard'); assert.equal(hard.levelLabel, 'Hard'); assert.equal(hard.bonus, 10);
  const plain = cardData({ valid: true, overall: 100 }, 'Priya');
  assert.equal(plain.level, 'normal'); assert.equal(plain.bonus, 0);
});

// ---------- Browser memory (stored.js) ----------

/** An in-memory stand-in for localStorage. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}
/** Storage that throws on every call, like a blocked or private-mode localStorage. */
const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};
/** Three valid runs, sorted by overall score, low to high. */
const storedRuns = () =>
  ['easy', 'normal', 'hard']
    .map((level) => playRun(level, 42))
    .map((run) => ({ run, overall: scoreRun(run).overall }))
    .sort((a, b) => a.overall - b.overall);

test('stored: saves the raw run as last and best, never a score', () => {
  const storage = memoryStorage();
  const [{ run, overall }] = storedRuns();
  assert.deepEqual(saveRun(run, { storage, now: 1_000_000 }), { last: true, best: true });
  const last = JSON.parse(storage.getItem(LAST_KEY));
  assert.deepEqual(Object.keys(last).sort(), ['at', 'run']);
  assert.equal(last.at, 1_000_000);
  assert.deepEqual(last.run, run);
  assert.equal(storage.getItem(BEST_KEY), storage.getItem(LAST_KEY));
  const shown = loadStored({ storage, now: 1_000_000 + 60_000 });
  assert.equal(shown.best.result.overall, overall);
  assert.equal(shown.last, null, 'the last run is not repeated when it is the best');
});

test('stored: best is replaced only by a higher score; last always moves', () => {
  const storage = memoryStorage();
  const [low, mid, high] = storedRuns();
  assert.ok(low.overall < mid.overall && mid.overall < high.overall);
  saveRun(mid.run, { storage, now: 1000 });
  assert.deepEqual(saveRun(low.run, { storage, now: 2000 }), { last: true, best: false });
  let shown = loadStored({ storage, now: 3000 });
  assert.equal(shown.best.result.overall, mid.overall);
  assert.equal(shown.best.at, 1000);
  assert.equal(shown.last.result.overall, low.overall);
  assert.equal(shown.last.at, 2000);
  assert.deepEqual(saveRun(high.run, { storage, now: 4000 }), { last: true, best: true });
  shown = loadStored({ storage, now: 5000 });
  assert.equal(shown.best.result.overall, high.overall);
  assert.equal(shown.last, null);
  // An equal score does not replace the best (the earlier run stays).
  assert.deepEqual(saveRun(high.run, { storage, now: 6000 }), { last: true, best: false });
  assert.equal(loadStored({ storage, now: 7000 }).best.at, 4000);
});

test('stored: an invalid run is not saved', () => {
  const storage = memoryStorage();
  const [{ run }] = storedRuns();
  assert.deepEqual(saveRun({ ...run, v: 3 }, { storage, now: 1000 }), { last: false, best: false });
  assert.deepEqual(saveRun({ ...run, reaction: { ...run.reaction, reactionTimesMs: [300, 310] } }, { storage, now: 1000 }), { last: false, best: false });
  assert.equal(storage.data.size, 0);
});

test('stored: tampered, broken and other-version entries are dropped and removed', () => {
  const [low, , high] = storedRuns();
  const now = 10_000_000;
  const entry = (run, at = now - 1000) => JSON.stringify({ run, at });
  // A score written into the entry is ignored: the run is re-scored.
  const withScore = JSON.stringify({ run: { ...low.run, overall: 160 }, at: now - 1000, overall: 160, score: 160 });
  let storage = memoryStorage({ [BEST_KEY]: withScore });
  assert.equal(loadStored({ storage, now }).best.result.overall, low.overall);

  const cases = {
    'not JSON': '{"run":',
    'a number': '160',
    'no run': JSON.stringify({ at: now }),
    'no time': JSON.stringify({ run: high.run }),
    'a time in the far future': entry(high.run, now + 3 * 24 * 3600 * 1000),
    'scoring version 3': entry({ ...high.run, v: 3 }),
    'an unknown level': entry({ ...high.run, level: 'insane' }),
    'impossible reaction times': entry({ ...high.run, reaction: { ...high.run.reaction, reactionTimesMs: high.run.reaction.reactionTimesMs.map(() => 120) } }),
    'too few rule trials': entry({ ...high.run, rules: { trials: high.run.rules.trials.slice(0, 5) } }),
    'an edited memory row': entry({ ...high.run, memory: { rounds: [{ length: 9, correct: true }] } }),
  };
  for (const [name, raw] of Object.entries(cases)) {
    storage = memoryStorage({ [BEST_KEY]: raw, [LAST_KEY]: raw });
    assert.deepEqual(loadStored({ storage, now }), { best: null, last: null }, name);
    assert.equal(storage.data.size, 0, `${name}: removed`);
  }
  assert.equal(validEntry(null), null);
  assert.equal(readEntry(null, BEST_KEY), null);
});

test('stored: last is hidden after 7 days and joining is offered only before then; best never expires', () => {
  const storage = memoryStorage();
  const [low, , high] = storedRuns();
  saveRun(high.run, { storage, now: 1000 });
  saveRun(low.run, { storage, now: 2000 });
  let shown = loadStored({ storage, now: 2000 + MAX_AGE_MS - 1 });
  assert.ok(shown.last);
  assert.equal(canJoin(shown.last, 2000 + MAX_AGE_MS - 1), true);
  shown = loadStored({ storage, now: 2000 + MAX_AGE_MS });
  assert.equal(shown.last, null);
  assert.equal(shown.best.result.overall, high.overall);
  assert.equal(canJoin(shown.best, 2000 + MAX_AGE_MS), false);
  shown = loadStored({ storage, now: 1000 + 400 * MAX_AGE_MS });
  assert.equal(shown.best.result.overall, high.overall);
  assert.equal(canJoin(null), false);
});

test('stored: a lost or lower best key falls back to the last run', () => {
  const [low, high] = storedRuns();
  const now = 50_000;
  let storage = memoryStorage({ [LAST_KEY]: JSON.stringify({ run: low.run, at: now - 10 }) });
  let shown = loadStored({ storage, now });
  assert.equal(shown.best.result.overall, low.overall);
  assert.equal(shown.last, null);
  storage = memoryStorage({
    [BEST_KEY]: JSON.stringify({ run: low.run, at: now - 20 }),
    [LAST_KEY]: JSON.stringify({ run: high.run, at: now - 10 }),
  });
  shown = loadStored({ storage, now });
  assert.equal(shown.best.result.overall, high.overall);
  assert.equal(shown.last, null);
});

test('stored: throwing or missing storage never throws', () => {
  const [{ run }] = storedRuns();
  assert.deepEqual(saveRun(run, { storage: throwingStorage, now: 1000 }), { last: false, best: false });
  assert.deepEqual(loadStored({ storage: throwingStorage, now: 1000 }), { best: null, last: null });
  assert.doesNotThrow(() => clearStored(throwingStorage));
  assert.deepEqual(saveRun(run, { storage: null }), { last: false, best: false });
  assert.deepEqual(loadStored({ storage: null }), { best: null, last: null });
  // No window in node: the default storage is simply absent.
  assert.deepEqual(loadStored(), { best: null, last: null });
  assert.doesNotThrow(() => clearStored());
});

test('stored: clearStored forgets both keys and leaves others alone', () => {
  const storage = memoryStorage({ 'clarus.attentionTest.level': 'hard' });
  const [low, high] = storedRuns();
  saveRun(high.run, { storage, now: 1000 });
  saveRun(low.run, { storage, now: 2000 });
  clearStored(storage);
  assert.deepEqual([...storage.data.keys()], ['clarus.attentionTest.level']);
});

test('stored: agoText', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  assert.equal(agoText(now - 20_000, now), 'just now');
  assert.equal(agoText(now + 5000, now), 'just now');
  assert.equal(agoText(now - 60_000, now), '1 minute ago');
  assert.equal(agoText(now - 5 * 60_000, now), '5 minutes ago');
  assert.equal(agoText(now - 3600_000, now), '1 hour ago');
  assert.equal(agoText(now - 2 * 3600_000, now), '2 hours ago');
  assert.equal(agoText(now - 30 * 3600_000, now), 'yesterday');
  assert.equal(agoText(now - 3 * 86400_000, now), '3 days ago');
  assert.match(agoText(now - 30 * 86400_000, now), /^on [A-Z][a-z]{2} \d{1,2}$/);
});
