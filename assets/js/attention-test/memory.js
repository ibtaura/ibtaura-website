// Part 2, digit memory: a pure state machine with no DOM.
// Ported from the Clarus Health Android Quick Check (QuickCheckEngine.kt SpanTest, with the 0.8 s "Right"/"Wrong"
// feedback that QuickCheckFlow.kt adds between rows). Times are milliseconds on one monotonic clock; every method
// takes the moment it happens, so tests can script the clock.
//
// Flow: showing (a row of `length` digits, no digit equal to the one before, for length x 1 s) -> entering (typed
// back on a keypad) -> feedback (0.8 s) -> showing the next row ... -> finished.
// A right answer adds a digit; a right answer at 9 digits finishes. Two wrong answers at the same length finish.
// The test runs 45 s from the first row; a row still showing or half typed at time-up is dropped.

import { MEMORY } from './scoring.js?v=1';

const RUN_MS = MEMORY.durationSeconds * 1000;

export class MemoryRun {
  /**
   * @param {number} start  the moment the first row shows (the 45 s run from here)
   * @param {() => number} random  a source in [0, 1); a digit is floor(random() * 10)
   */
  constructor(start, random = Math.random) {
    this.random = random;
    this.start = start;
    this.end = start + RUN_MS;
    this.length = MEMORY.startLength;
    this.wrongAtLength = 0;
    /** One per row answered, in order: { length, correct }. */
    this.rounds = [];
    this.digits = [];
    this.typed = [];
    /** The row as typed and whether it was right, during the feedback. */
    this.lastAnswer = null;
    /** 'showing' | 'entering' | 'feedback' | 'finished' */
    this.phase = 'showing';
    this.phaseEnds = null;
    this.finishedAfterFeedback = false;
    this.newRound(start);
  }

  get isFinished() {
    return this.phase === 'finished';
  }

  get entered() {
    return [...this.typed];
  }

  remaining(moment) {
    if (this.phase === 'finished') return 0;
    return Math.max(0, this.end - moment);
  }

  /** Moves the clock: hides a row that has shown long enough, ends the feedback, and finishes at time-up. */
  advance(now) {
    if (this.phase === 'finished') return;
    if (now >= this.end) {
      this.finish();
      return;
    }
    if (this.phase === 'showing' && now >= this.phaseEnds) {
      this.phase = 'entering';
      this.phaseEnds = null;
    }
    if (this.phase === 'feedback' && now >= this.phaseEnds) {
      const shownAt = this.phaseEnds;
      this.lastAnswer = null;
      if (this.finishedAfterFeedback) this.finish();
      else this.newRound(shownAt);
      // The next row may already have shown long enough if the clock jumped.
      if (this.phase === 'showing' && now >= this.phaseEnds) {
        this.phase = 'entering';
        this.phaseEnds = null;
      }
    }
  }

  /** A keypad digit. Returns true or false when it completes the row, null otherwise (or when ignored). */
  type(digit, moment) {
    this.advance(moment);
    if (this.phase !== 'entering' || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
    this.typed.push(digit);
    if (this.typed.length < this.digits.length) return null;
    const right = this.typed.every((d, i) => d === this.digits[i]);
    this.rounds.push({ length: this.digits.length, correct: right });
    this.lastAnswer = { row: [...this.typed], digits: [...this.digits], correct: right };
    if (right) {
      if (this.length >= MEMORY.maxLength) this.finishedAfterFeedback = true;
      else {
        this.length += 1;
        this.wrongAtLength = 0;
      }
    } else {
      this.wrongAtLength += 1;
      if (this.wrongAtLength >= MEMORY.missesToEnd) this.finishedAfterFeedback = true;
    }
    this.phase = 'feedback';
    this.phaseEnds = moment + MEMORY.feedbackMs;
    return right;
  }

  /** Backspace: removes the last typed digit while entering. */
  deleteLast(moment) {
    this.advance(moment);
    if (this.phase !== 'entering' || this.typed.length === 0) return false;
    this.typed.pop();
    return true;
  }

  /** The memory part of the raw run. */
  result() {
    return { rounds: this.rounds.map((r) => ({ length: r.length, correct: r.correct })) };
  }

  finish() {
    this.phase = 'finished';
    this.phaseEnds = null;
    this.typed = [];
  }

  newRound(moment) {
    this.digits = this.drawRow(this.length);
    this.typed = [];
    this.phase = 'showing';
    this.phaseEnds = moment + this.digits.length * MEMORY.showPerDigitMs;
  }

  oneDigit() {
    const r = Number(this.random()) || 0;
    return Math.min(9, Math.max(0, Math.floor(r * 10)));
  }

  /** A row with no digit next to the same digit (a repeat is re-drawn; a stuck source can't stall it). */
  drawRow(count) {
    const row = [];
    while (row.length < count) {
      let next = this.oneDigit();
      let tries = 0;
      while (row.length && next === row[row.length - 1] && tries < 20) {
        next = this.oneDigit();
        tries += 1;
      }
      if (row.length && next === row[row.length - 1]) next = (next + 1) % 10;
      row.push(next);
    }
    return row;
  }
}
