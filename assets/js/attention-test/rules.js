// Part 3, rule switch: a pure state machine with no DOM.
// Ported from the Clarus Health Quick Check (Windows app switching.ts, a port of the Mac SwitchingPlan.swift and
// RuleSwitchRun.swift), shortened to 10 trials, with levels. Times are milliseconds on one monotonic clock; every
// method takes the moment it happens, so tests can script the clock.
//
// Each trial shows a number under its rule; the level (scoring.js LEVELS) sets which rules, comparison numbers
// (pivots), number range and answer window are used:
//   'parity'    "Odd or even?"                 left (F) Odd,   right (J) Even
//   'magnitude' "Lower or higher than {pivot}?" left (F) Lower, right (J) Higher
//   'multiple3' "Multiple of 3?"               left (F) Yes,   right (J) No
// A number waits for the level's answer window (no answer is wrong), then a 500 ms blank comes before the next one.

import { RULES, LEVELS, DEFAULT_LEVEL, RULE_ANSWERS, expectedAnswer, levelOf } from './scoring.js?v=2';

/** The most switches, or repeats, in a row. */
export const LONGEST_STREAK = 3;

const round1 = (ms) => Math.round(ms * 10) / 10;
const settings = (level) => levelOf(level) || LEVELS[DEFAULT_LEVEL];

export function ruleQuestion(rule, pivot) {
  if (rule === 'parity') return 'Odd or even?';
  if (rule === 'magnitude') return `Lower or higher than ${pivot}?`;
  return 'Multiple of 3?';
}

const LABELS = Object.freeze({
  parity: Object.freeze({ left: 'Odd', right: 'Even' }),
  magnitude: Object.freeze({ left: 'Lower', right: 'Higher' }),
  multiple3: Object.freeze({ left: 'Yes', right: 'No' }),
});
export const ruleLabels = (rule) => LABELS[rule] || LABELS.parity;

/** The answer word for a side under a rule: 'odd' | 'even' | 'lower' | 'higher' | 'yes' | 'no'. */
export function answerWord(rule, side) {
  const words = RULE_ANSWERS[rule] || RULE_ANSWERS.parity;
  return side === 'left' ? words[0] : words[1];
}

/** The right answer for a number under a rule (pivot only for 'magnitude'). */
export const rightAnswer = (rule, n, pivot = null) => expectedAnswer(rule, n, pivot);

/** One item of a list from a random source in [0, 1). */
const pick = (list, random) => list[Math.min(Math.floor(random() * list.length), list.length - 1)];

/**
 * A number in the level's range that is not the pivot and not the number before. Re-drawn a few times, then
 * stepped upward, so a stuck random source can't stall it.
 */
function drawNumber(lv, random, pivot, previous) {
  const span = lv.numberMax - lv.numberMin + 1;
  const ok = (n) => n !== pivot && n !== previous;
  let n = lv.numberMin + Math.min(Math.floor(random() * span), span - 1);
  for (let tries = 0; !ok(n) && tries < 20; tries += 1) n = lv.numberMin + Math.min(Math.floor(random() * span), span - 1);
  while (!ok(n)) n = n >= lv.numberMax ? lv.numberMin : n + 1;
  return n;
}

/**
 * The plan for a level: a random first rule; after that a coin decides whether the rule switches (to another of the
 * level's rules), flipped once a run of switches or of repeats reaches 3 (SwitchingPlan.steps). Magnitude steps take a
 * pivot from the level; every number is in the level's range, never the pivot and never the number before.
 * @param {string} level  a key of LEVELS
 * @param {() => number} random  a source in [0, 1)
 * @returns {{rule: string, n: number, pivot: number | null, isSwitch: boolean}[]}
 */
export function planSteps(level = DEFAULT_LEVEL, random = Math.random, count = RULES.trials) {
  const lv = settings(level);
  const steps = [];
  let rule = pick(lv.rules, random);
  let streak = { isSwitch: false, length: 0 };
  let previous = null;
  for (let index = 0; index < count; index += 1) {
    let isSwitch = index > 0 && random() < 0.5;
    if (index > 0 && streak.length >= LONGEST_STREAK && isSwitch === streak.isSwitch) isSwitch = !isSwitch;
    if (isSwitch) {
      const others = lv.rules.filter((r) => r !== rule);
      rule = others.length === 1 ? others[0] : pick(others, random);
    }
    if (index > 0) streak = streak.isSwitch === isSwitch ? { isSwitch, length: streak.length + 1 } : { isSwitch, length: 1 };
    const pivot = rule === 'magnitude' ? pick(lv.pivots, random) : null;
    const n = drawNumber(lv, random, pivot, previous);
    previous = n;
    steps.push({ rule, n, pivot, isSwitch });
  }
  return steps;
}

export class RulesRun {
  /**
   * @param {{rule: string, n: number, pivot: number | null, isSwitch: boolean}[]} steps  from planSteps()
   * @param {number} start  the moment the first number shows
   * @param {string} level  a key of LEVELS; sets the answer window
   */
  constructor(steps, start, level = DEFAULT_LEVEL) {
    this.steps = steps;
    this.windowMs = settings(level).answerWindowMs;
    /** { n, rule, pivot, isSwitch, answer, correct, rtMs }, the raw-run format. */
    this.trials = [];
    /** 'showing' { index, shownAt } | 'blank' { next, until } | 'over' */
    this.stage = steps.length ? { kind: 'showing', index: 0, shownAt: start } : { kind: 'over' };
  }

  get isOver() {
    return this.stage.kind === 'over';
  }

  /** The step on screen, or null during a blank. */
  get current() {
    return this.stage.kind === 'showing' ? this.steps[this.stage.index] : null;
  }

  /** 1-based number of the trial on screen (or of the last one answered). */
  get number() {
    return this.stage.kind === 'showing' ? this.stage.index + 1 : this.trials.length;
  }

  get count() {
    return this.steps.length;
  }

  get nextEvent() {
    if (this.stage.kind === 'showing') return { kind: 'timeOut', at: this.stage.shownAt + this.windowMs };
    if (this.stage.kind === 'blank') return { kind: 'nextDigit', at: this.stage.until };
    return null;
  }

  /**
   * An answer, 'left' or 'right'. Returns the recorded trial, or null when ignored: outside a trial, or faster
   * than RULES.fastestMs (too fast to have read the number; usually a key still held from the last one).
   */
  answered(side, moment) {
    if (this.stage.kind !== 'showing' || (side !== 'left' && side !== 'right')) return null;
    const rt = moment - this.stage.shownAt;
    if (rt >= this.windowMs) {
      this.timedOut(this.stage.shownAt + this.windowMs);
      return null;
    }
    if (rt < RULES.fastestMs) return null;
    const step = this.steps[this.stage.index];
    const answer = answerWord(step.rule, side);
    const trial = {
      n: step.n,
      rule: step.rule,
      pivot: step.pivot,
      isSwitch: step.isSwitch,
      answer,
      correct: answer === rightAnswer(step.rule, step.n, step.pivot),
      rtMs: round1(rt),
    };
    this.record(trial, moment);
    return trial;
  }

  /** The answer window ran out: wrong, with no answer and no time. */
  timedOut(moment) {
    if (this.stage.kind !== 'showing') return null;
    const step = this.steps[this.stage.index];
    const trial = { n: step.n, rule: step.rule, pivot: step.pivot, isSwitch: step.isSwitch, answer: null, correct: false, rtMs: null };
    this.record(trial, moment);
    return trial;
  }

  blankEnded(moment) {
    if (this.stage.kind !== 'blank') return;
    this.stage = { kind: 'showing', index: this.stage.next, shownAt: moment };
  }

  /**
   * Moves the clock to `now`: a timeout at its own moment, and a blank that has ended shows the next number at `now`
   * (the frame that paints it). Returns the kinds handled, in order.
   */
  advance(now) {
    const handled = [];
    for (let guard = 0; guard < 100; guard += 1) {
      const next = this.nextEvent;
      if (!next || next.at > now) break;
      if (next.kind === 'timeOut') this.timedOut(next.at);
      else this.blankEnded(now);
      handled.push(next.kind);
      if (next.kind === 'nextDigit') break;
    }
    return handled;
  }

  /** The rules part of the raw run. */
  result() {
    return { trials: this.trials.map((t) => ({ ...t })) };
  }

  record(trial, moment) {
    this.trials.push(trial);
    this.stage =
      this.trials.length < this.steps.length
        ? { kind: 'blank', next: this.trials.length, until: moment + RULES.blankMs }
        : { kind: 'over' };
  }
}
