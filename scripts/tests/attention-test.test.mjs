// Tests for the Attention Test engines. Run: node --test scripts/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ReactionRun } from '../../assets/js/attention-test/reaction.js';
import { MemoryRun } from '../../assets/js/attention-test/memory.js';
import { RulesRun, planSteps, rightAnswer, answerWord, LONGEST_STREAK, PLAN_DIGITS } from '../../assets/js/attention-test/rules.js';
import { REACTION, MEMORY, RULES, scoreRun, checkRun } from '../../assets/js/attention-test/scoring.js';
import { shareUrl, cleanFriendCode, loadFriendCode, FRIEND_CODE_KEY } from '../../assets/js/attention-test/share.js?v=2';

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

// ---------- Rules ----------

test('rules: the plan never runs more than 3 switches or 3 repeats in a row, and never shows 5', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const steps = planSteps(seeded(seed), 40);
    assert.equal(steps[0].isSwitch, false);
    let streak = 0;
    let kind = null;
    for (let i = 1; i < steps.length; i += 1) {
      const s = steps[i];
      assert.ok(PLAN_DIGITS.includes(s.digit) && s.digit !== 5);
      assert.equal(s.isSwitch, s.rule !== steps[i - 1].rule);
      streak = s.isSwitch === kind ? streak + 1 : 1;
      kind = s.isSwitch;
      assert.ok(streak <= LONGEST_STREAK, `seed ${seed}: streak ${streak} at ${i}`);
    }
  }
});

test('rules: a coin that always says switch is flipped after 3', () => {
  // first rule (0.1 -> parity), then for each step: switch coin 0.1 (switch), digit 0
  const values = [0.1, 0];
  for (let i = 1; i < 10; i += 1) values.push(0.1, 0);
  const steps = planSteps(scripted(...values), 10);
  assert.deepEqual(steps.map((s) => s.isSwitch), [false, true, true, true, false, true, true, true, false, true]);
  assert.equal(steps[0].rule, 'parity');
});

test('rules: answers, words, too-fast presses and timeouts', () => {
  assert.equal(rightAnswer('parity', 3), 'odd');
  assert.equal(rightAnswer('magnitude', 6), 'higher');
  assert.equal(answerWord('magnitude', 'left'), 'lower');
  const steps = [
    { rule: 'parity', digit: 3, isSwitch: false },
    { rule: 'magnitude', digit: 8, isSwitch: true },
    { rule: 'magnitude', digit: 2, isSwitch: false },
  ];
  const run = new RulesRun(steps, 1000);
  assert.equal(run.answered('left', 1100), null, 'faster than 150 ms is ignored');
  const t1 = run.answered('left', 1800.04);
  assert.deepEqual(t1, { digit: 3, rule: 'parity', isSwitch: false, answer: 'odd', correct: true, rtMs: 800 });
  assert.equal(run.current, null, 'blank between digits');
  assert.equal(run.answered('right', 1900), null);
  assert.deepEqual(run.advance(2299), []);
  assert.deepEqual(run.advance(2305), ['nextDigit']);
  assert.equal(run.current.digit, 8);
  run.answered('left', 3000); // lower: wrong
  assert.equal(run.trials[1].correct, false);
  run.advance(3500);
  assert.deepEqual(run.advance(6500), ['timeOut']);
  assert.deepEqual(run.trials[2], { digit: 2, rule: 'magnitude', isSwitch: false, answer: null, correct: false, rtMs: null });
  assert.ok(run.isOver);
});

// ---------- A full scripted run ----------

test('a full scripted run passes checkRun and scoreRun', () => {
  const random = seeded(42);
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
  const memory = new MemoryRun(100_000, random);
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
  // Rules: answer right in 900 ms, one wrong, one timeout.
  const rules = new RulesRun(planSteps(random), 200_000);
  t = 200_000;
  let n = 0;
  while (!rules.isOver) {
    if (rules.current) {
      n += 1;
      const step = rules.current;
      if (n === 4) {
        t += RULES.answerWindowMs;
        rules.advance(t);
      } else {
        const want = rightAnswer(step.rule, step.digit);
        const correctSide = want === 'odd' || want === 'lower' ? 'left' : 'right';
        const side = n === 7 ? (correctSide === 'left' ? 'right' : 'left') : correctSide;
        rules.answered(side, (t += 900));
      }
    }
    t += RULES.blankMs;
    rules.advance(t);
  }
  const run = {
    v: 1,
    device: 'computer',
    reaction: reaction.result(),
    memory: memory.result(),
    rules: rules.result(),
  };
  assert.equal(checkRun(run), null);
  const result = scoreRun(run);
  assert.equal(result.valid, true);
  assert.ok(result.overall >= 40 && result.overall <= 160);
  assert.equal(result.reaction.falseStarts, 1);
  assert.equal(result.memory.bestSpan, 6);
  assert.equal(result.rules.correct, 8);
  assert.equal(result.rules.total, 10);
  assert.ok(result.reaction.answers >= 8);
});

test('a run with too few answers is valid in shape but not scorable', () => {
  const reaction = new ReactionRun(0, () => 0.5);
  let t = 0;
  while (!reaction.isOver) reaction.advance((t += 20)); // never presses: dots time out
  // Rules: every digit runs out (a complete 10-digit part, as checkRun requires).
  const rules = new RulesRun(planSteps(seeded(9)), 0);
  for (let t2 = 0; !rules.isOver; t2 += 100) rules.advance(t2);
  assert.equal(rules.trials.length, RULES.trials);
  const run = { v: 1, device: 'phone', reaction: reaction.result(), memory: { rounds: [] }, rules: rules.result() };
  assert.equal(checkRun(run), null);
  const result = scoreRun(run);
  assert.equal(result.valid, false);
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
