// Part 1, the 45-second reaction test: a pure state machine with no DOM.
// Ported from the Clarus Health Quick Check (Windows app reaction.ts, itself a port of the Mac ReactionTestRun.swift),
// without pause and resume. Times are milliseconds on one monotonic clock (performance.now() in the browser);
// every method takes the moment it happens, so tests can script the clock.
//
// Flow: waiting (a dot is due 1-4 s after the start or after the last answer) -> dotShowing -> answered, timed out
// after 30 s, or dropped at the hard end of the run -> waiting ... -> over at 45 s.
// The first second after an answer, a false start or a timeout shows the result; presses then are ignored.
// A press while waiting (after that second) is a false start ("Too soon") and restarts the wait.

import { REACTION } from './scoring.js?v=2';

const RUN_MS = REACTION.durationSeconds * 1000;
const round1 = (ms) => Math.round(ms * 10) / 10;

/** The smallest gap between the dot and the edge of its area, in CSS pixels. */
export const DOT_MARGIN = 8;

/**
 * Where to draw a dot inside an area (the pad, minus the label band), for a level's reactionDot
 * ({ sizePx, position: 'center' | 'random' }). The size shrinks to fit a small area; a random spot keeps the whole
 * dot inside with at least DOT_MARGIN px to spare. Pure: the caller passes the area and a random source in [0, 1).
 * @returns {{ size: number, left: number, top: number }}  the dot's box, relative to the area's top-left corner
 */
export function dotLayout(area, dot, random = Math.random) {
  const width = Math.max(0, Number(area && area.width) || 0);
  const height = Math.max(0, Number(area && area.height) || 0);
  const size = Math.max(0, Math.min(dot.sizePx, width - 2 * DOT_MARGIN, height - 2 * DOT_MARGIN));
  const spot = (room) => {
    if (dot.position !== 'random' || room <= 0) return Math.max(0, room) / 2;
    const r = Math.min(Math.max(Number(random()) || 0, 0), 1);
    return r * room;
  };
  const left = DOT_MARGIN + spot(width - 2 * DOT_MARGIN - size);
  const top = DOT_MARGIN + spot(height - 2 * DOT_MARGIN - size);
  // Floors keep the dot inside: floor(left) + floor(size) <= left + size.
  return { size: Math.floor(size), left: Math.floor(left), top: Math.floor(top) };
}

export class ReactionRun {
  /**
   * @param {number} start  the moment the run starts
   * @param {() => number} random  a source in [0, 1); each wait is minGap + random() * (maxGap - minGap)
   */
  constructor(start, random = Math.random) {
    this.start = start;
    this.end = start + RUN_MS;
    this.random = random;
    /** One time per dot, in order; a dot not answered within 30 s holds REACTION.timeoutMs. */
    this.reactionTimesMs = [];
    this.falseStarts = 0;
    this.dotsShown = 0;
    /** { kind: 'reaction', ms } | { kind: 'tooEarly' } | { kind: 'missed' }, with the moment it began. */
    this.lastFeedback = null;
    this.stage = { kind: 'waiting', dotDue: start + this.nextDelay() };
  }

  /** The dot was drawn; `moment` is the timestamp of the frame that first paints it. */
  dotShown(moment) {
    if (this.stage.kind !== 'waiting' || moment >= this.end) return;
    this.stage = { kind: 'dotShowing', shownAt: moment };
    this.dotsShown += 1;
    this.lastFeedback = null;
  }

  /** A tap or a Space press. Returns { kind: 'answered', ms } | { kind: 'falseStart' } | { kind: 'ignored' }. */
  pressed(moment) {
    if (this.stage.kind === 'over' || moment >= this.end) return { kind: 'ignored' };
    const ends = this.feedbackEnds;
    if (ends !== null && moment < ends) return { kind: 'ignored' };
    if (this.stage.kind === 'dotShowing') {
      // A press after the 30 s limit is the timeout, not an answer.
      if (moment - this.stage.shownAt >= REACTION.timeoutMs) {
        this.timedOut(this.stage.shownAt + REACTION.timeoutMs);
        return { kind: 'ignored' };
      }
      const ms = round1(Math.max(0, moment - this.stage.shownAt));
      this.reactionTimesMs.push(ms);
      this.waitForNextDot(moment);
      this.lastFeedback = { feedback: { kind: 'reaction', ms }, shownAt: moment };
      return { kind: 'answered', ms };
    }
    // waiting
    this.falseStarts += 1;
    this.waitForNextDot(moment);
    this.lastFeedback = { feedback: { kind: 'tooEarly' }, shownAt: moment };
    return { kind: 'falseStart' };
  }

  /** The dot has shown for 30 s with no answer. */
  timedOut(moment) {
    if (this.stage.kind !== 'dotShowing') return;
    this.reactionTimesMs.push(REACTION.timeoutMs);
    this.waitForNextDot(moment);
    this.lastFeedback = { feedback: { kind: 'missed' }, shownAt: moment };
  }

  /** The hard end. A dot still showing is dropped, not counted. */
  ended() {
    if (this.stage.kind === 'over') return;
    this.stage = { kind: 'over' };
    this.lastFeedback = null;
  }

  get isOver() {
    return this.stage.kind === 'over';
  }

  remaining(moment) {
    return Math.max(0, this.end - moment);
  }

  /** The next scheduled event: { kind: 'showDot' | 'timeOut' | 'reachEnd', at }, or null once over. */
  get nextEvent() {
    let pending = null;
    if (this.stage.kind === 'over') return null;
    if (this.stage.kind === 'waiting') pending = { kind: 'showDot', at: this.stage.dotDue };
    if (this.stage.kind === 'dotShowing') pending = { kind: 'timeOut', at: this.stage.shownAt + REACTION.timeoutMs };
    if (!pending || pending.at >= this.end) return { kind: 'reachEnd', at: this.end };
    return pending;
  }

  /**
   * Moves the clock to `now` (call it once per animation frame with the frame's timestamp). Handles every event
   * that has come due: a timeout at its own moment, the end at 45 s, and a due dot shown at `now`, the frame that
   * paints it. Returns the kinds handled, in order.
   */
  advance(now) {
    const handled = [];
    for (let guard = 0; guard < 100; guard += 1) {
      const next = this.nextEvent;
      if (!next || next.at > now) break;
      // A dot due before the end but first drawable after it never shows.
      const kind = next.kind === 'showDot' && now >= this.end ? 'reachEnd' : next.kind;
      if (kind === 'reachEnd') this.ended();
      else if (kind === 'timeOut') this.timedOut(next.at);
      else this.dotShown(now);
      handled.push(kind);
      if (kind === 'showDot' || kind === 'reachEnd') break;
    }
    return handled;
  }

  /** The result to show at `moment`, or null outside the 1 s after an answer, a false start or a timeout. */
  feedback(moment) {
    const ends = this.feedbackEnds;
    if (!this.lastFeedback || ends === null || moment >= ends) return null;
    return this.lastFeedback.feedback;
  }

  get feedbackEnds() {
    return this.lastFeedback ? this.lastFeedback.shownAt + REACTION.showResultMs : null;
  }

  /** The reaction part of the raw run. */
  result() {
    return {
      durationSeconds: REACTION.durationSeconds,
      reactionTimesMs: [...this.reactionTimesMs],
      falseStarts: this.falseStarts,
    };
  }

  nextDelay() {
    const r = Math.min(Math.max(Number(this.random()) || 0, 0), 1);
    return REACTION.minGapMs + r * (REACTION.maxGapMs - REACTION.minGapMs);
  }

  waitForNextDot(moment) {
    this.stage = { kind: 'waiting', dotDue: moment + this.nextDelay() };
  }
}
