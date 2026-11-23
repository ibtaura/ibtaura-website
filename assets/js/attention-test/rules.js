// Part 3, rule switch: a pure state machine with no DOM.
// Ported from the Clarus Health Quick Check (Windows app switching.ts, a port of the Mac SwitchingPlan.swift and
// RuleSwitchRun.swift), shortened to 10 digits. Times are milliseconds on one monotonic clock; every method takes the
// moment it happens, so tests can script the clock.
//
// Each trial shows a digit 1-9 (never 5) under its rule: 'parity' ("Odd or even?") or 'magnitude' ("Lower or higher
// than 5?"). The left button (or F) answers Odd / Lower, the right one (or J) Even / Higher. A digit waits 3 s
// (no answer is wrong), then a 500 ms blank comes before the next one.

import { RULES } from './scoring.js?v=1';

export const PLAN_DIGITS = Object.freeze([1, 2, 3, 4, 6, 7, 8, 9]);
/** The most switches, or repeats, in a row. */
export const LONGEST_STREAK = 3;

const round1 = (ms) => Math.round(ms * 10) / 10;

export const ruleQuestion = (rule) => (rule === 'parity' ? 'Odd or even?' : 'Lower or higher than 5?');
export const ruleLabels = (rule) => (rule === 'parity' ? { left: 'Odd', right: 'Even' } : { left: 'Lower', right: 'Higher' });

/** The answer word for a side under a rule: 'odd' | 'even' | 'lower' | 'higher'. */
export function answerWord(rule, side) {
  if (rule === 'parity') return side === 'left' ? 'odd' : 'even';
  return side === 'left' ? 'lower' : 'higher';
}

export function rightAnswer(rule, digit) {
  return rule === 'parity' ? (digit % 2 === 0 ? 'even' : 'odd') : digit > 5 ? 'higher' : 'lower';
}

/**
 * The plan: a random first rule; after that a coin decides whether the rule switches, flipped once a run of
 * switches or of repeats reaches 3 (SwitchingPlan.steps).
 * @param {() => number} random  a source in [0, 1)
 */
export function planSteps(random = Math.random, count = RULES.trials) {
  const steps = [];
  let rule = random() < 0.5 ? 'parity' : 'magnitude';
  let streak = { isSwitch: false, length: 0 };
  for (let index = 0; index < count; index += 1) {
    let isSwitch = index > 0 && random() < 0.5;
    if (index > 0 && streak.length >= LONGEST_STREAK && isSwitch === streak.isSwitch) isSwitch = !isSwitch;
    if (isSwitch) rule = rule === 'parity' ? 'magnitude' : 'parity';
    if (index > 0) streak = streak.isSwitch === isSwitch ? { isSwitch, length: streak.length + 1 } : { isSwitch, length: 1 };
    const digit = PLAN_DIGITS[Math.min(Math.floor(random() * PLAN_DIGITS.length), PLAN_DIGITS.length - 1)];
    steps.push({ rule, digit, isSwitch });
  }
  return steps;
}

export class RulesRun {
  /**
   * @param {{rule: string, digit: number, isSwitch: boolean}[]} steps  from planSteps()
   * @param {number} start  the moment the first digit shows
   */
  constructor(steps, start) {
    this.steps = steps;
    /** { digit, rule, isSwitch, answer, correct, rtMs }, the raw-run format. */
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

  /** 1-based number of the digit on screen (or of the last one answered). */
  get number() {
    return this.stage.kind === 'showing' ? this.stage.index + 1 : this.trials.length;
  }

  get count() {
    return this.steps.length;
  }

  get nextEvent() {
    if (this.stage.kind === 'showing') return { kind: 'timeOut', at: this.stage.shownAt + RULES.answerWindowMs };
    if (this.stage.kind === 'blank') return { kind: 'nextDigit', at: this.stage.until };
    return null;
  }

  /**
   * An answer, 'left' or 'right'. Returns the recorded trial, or null when ignored: outside a digit, or faster
   * than RULES.fastestMs (too fast to have read the digit; usually a key still held from the last one).
   */
  answered(side, moment) {
    if (this.stage.kind !== 'showing' || (side !== 'left' && side !== 'right')) return null;
    const rt = moment - this.stage.shownAt;
    if (rt >= RULES.answerWindowMs) {
      this.timedOut(this.stage.shownAt + RULES.answerWindowMs);
      return null;
    }
    if (rt < RULES.fastestMs) return null;
    const step = this.steps[this.stage.index];
    const answer = answerWord(step.rule, side);
    const trial = { digit: step.digit, rule: step.rule, isSwitch: step.isSwitch, answer, correct: answer === rightAnswer(step.rule, step.digit), rtMs: round1(rt) };
    this.record(trial, moment);
    return trial;
  }

  /** 3 s with no answer: wrong, with no answer and no time. */
  timedOut(moment) {
    if (this.stage.kind !== 'showing') return null;
    const step = this.steps[this.stage.index];
    const trial = { digit: step.digit, rule: step.rule, isSwitch: step.isSwitch, answer: null, correct: false, rtMs: null };
    this.record(trial, moment);
    return trial;
  }

  blankEnded(moment) {
    if (this.stage.kind !== 'blank') return;
    this.stage = { kind: 'showing', index: this.stage.next, shownAt: moment };
  }

  /**
   * Moves the clock to `now`: a timeout at its own moment, and a blank that has ended shows the next digit at `now`
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
