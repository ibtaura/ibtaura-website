// Clarus Attention Test: screens, flow, timers and input. The rules live in the pure engines
// (reaction.js, memory.js, rules.js) and the scoring in scoring.js; this file only drives them.
//
// Timing: one requestAnimationFrame loop runs while a part is on screen. Each frame passes its timestamp to the
// engine, so a dot or digit is timed from the frame that first paints it. Presses use the event's own timestamp
// (the same clock as performance.now()), falling back to performance.now().

import { MEMORY, RULES, scoreRun, checkRun, percentileOf, bandOf } from './scoring.js?v=1';
import { track } from './track.js?v=1';
import { ReactionRun } from './reaction.js?v=1';
import { MemoryRun } from './memory.js?v=1';
import { RulesRun, planSteps, ruleQuestion, ruleLabels } from './rules.js?v=1';

const $ = (id) => document.getElementById(id);
const game = $('at-game');
if (game) init();

function init() {
  const device = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = $('at-live');
  const screens = Array.from(game.querySelectorAll('.at-screen'));

  const PARTS = [
    {
      key: 'reaction',
      name: 'Reaction',
      title: 'Tap the green dot',
      text:
        device === 'phone'
          ? 'Tap the pad as soon as the green dot appears. It runs for 45 seconds; taps before the dot count as too soon.'
          : 'Click the pad, or press Space, as soon as the green dot appears. It runs for 45 seconds; presses before the dot count as too soon.',
      start: startReaction,
    },
    {
      key: 'memory',
      name: 'Digit memory',
      title: 'Remember the digits',
      text:
        device === 'phone'
          ? 'A row of digits shows for a moment, then hides. Type it back on the keypad. Each right answer adds a digit. 45 seconds.'
          : 'A row of digits shows for a moment, then hides. Type it back with the number keys or the keypad. Each right answer adds a digit. 45 seconds.',
      start: startMemory,
    },
    {
      key: 'rules',
      name: 'Rule switch',
      title: 'Follow the rule',
      text:
        device === 'phone'
          ? 'Answer each digit by the rule above it: odd or even, or lower or higher than 5. 10 digits, 3 seconds each.'
          : 'Answer each digit by the rule above it: odd or even, or lower or higher than 5. Press F for the left button and J for the right. 10 digits, 3 seconds each.',
      start: startRules,
    },
  ];

  let run = null; // the raw run being built
  let partIndex = 0;
  let active = null; // the part on screen: { kind, frame(ts), key(e, t), abort() }
  let rafId = 0;
  let inTest = false;
  let board = null;
  const challenge = readChallenge();

  if (device === 'phone') game.classList.add('at-is-phone');

  // ---------- Helpers ----------

  function show(id) {
    for (const s of screens) s.hidden = s.id !== id;
    const screen = $(id);
    const heading = screen && screen.querySelector('h1, h2');
    if (heading) heading.focus({ preventScroll: true });
  }

  let announceFlip = false;
  function announce(text) {
    announceFlip = !announceFlip;
    // A trailing no-break space makes a repeat of the same words count as a change.
    live.textContent = announceFlip ? text : `${text} `;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function clockText(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function eventTime(e) {
    const now = performance.now();
    const ts = e && e.timeStamp;
    return typeof ts === 'number' && ts > 0 && ts <= now + 1 && now - ts < 1000 ? Math.min(ts, now) : now;
  }

  function setIdle(button, idle) {
    button.setAttribute('aria-disabled', idle ? 'true' : 'false');
    button.classList.toggle('is-idle', idle);
  }

  function scrollToGame() {
    const top = game.getBoundingClientRect().top;
    const offset = 96; // the fixed nav bar
    if (top >= offset - 8 && top <= offset + 120) return;
    const y = Math.max(0, top + window.scrollY - offset);
    try {
      if (window.lenis && typeof window.lenis.scrollTo === 'function') {
        window.lenis.scrollTo(y, { immediate: reducedMotion });
        return;
      }
    } catch (_) {
      /* fall through */
    }
    window.scrollTo({ top: y, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (active) active.frame(ts);
  }
  function startLoop() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---------- Challenge links ----------

  function readChallenge() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = (params.get('challenge') || '').trim();
      if (!/^\d{2,3}$/.test(raw)) return null;
      const score = Number(raw);
      if (!Number.isInteger(score) || score < 40 || score > 160) return null;
      const name = Array.from((params.get('by') || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim())
        .slice(0, 24)
        .join('')
        .trim();
      return { score, by: name || null };
    } catch (_) {
      return null;
    }
  }

  if (challenge) {
    const banner = $('at-challenge');
    banner.textContent = `${challenge.by || 'Someone'} scored ${challenge.score}. Can you beat it?`;
    banner.hidden = false;
    track('challenge_open', { score: challenge.score });
  }

  // ---------- Flow ----------

  function startTest() {
    run = { v: 1, device };
    inTest = true;
    track('test_start', { device });
    $('at-share').replaceChildren();
    showInterstitial(0);
  }

  function showInterstitial(index, note) {
    partIndex = index;
    const part = PARTS[index];
    setText($('at-inter-kicker'), `Part ${index + 1} of ${PARTS.length} · ${part.name}`);
    setText($('at-inter-title'), part.title);
    setText($('at-inter-text'), part.text);
    const noteEl = $('at-inter-note');
    noteEl.hidden = !note;
    noteEl.textContent = note || '';
    show('at-inter');
    scrollToGame();
  }

  function startPart() {
    if (!run) return;
    PARTS[partIndex].start();
    scrollToGame();
  }

  function partDone(key, result) {
    active = null;
    stopLoop();
    run[key] = result;
    track('part_complete', { part: key });
    if (key === 'reaction') {
      // The app's rule: a reaction part that can't be scored voids the run, so stop here instead of playing on.
      const check = scoreRun({ ...run, memory: { rounds: [] }, rules: { trials: [] } });
      if (!check.valid) {
        showInvalid(check.reason);
        return;
      }
    }
    if (partIndex + 1 < PARTS.length) showInterstitial(partIndex + 1);
    else finishTest();
  }

  function abortPart(note) {
    if (!active) return;
    active.abort();
    active = null;
    stopLoop();
    showInterstitial(partIndex, note);
  }

  const INVALID_COPY = {
    tooFewAnswers: "Fewer than 8 dots were answered, so this run can't be scored. Try again.",
    tooManyFalseStarts: "Too many taps came before the dot, so this run can't be scored. Try again.",
  };

  function showInvalid(reason) {
    inTest = false;
    stopLoop();
    track('test_invalid', { reason });
    setText($('at-invalid-text'), INVALID_COPY[reason] || "Something in this run doesn't look right, so it can't be scored. Try again.");
    show('at-invalid');
    announce(INVALID_COPY[reason] || "This run can't be scored.");
    scrollToGame();
  }

  function finishTest() {
    inTest = false;
    const problem = checkRun(run);
    if (problem) {
      showInvalid(problem);
      return;
    }
    const result = scoreRun(run);
    if (!result.valid) {
      showInvalid(result.reason);
      return;
    }
    track('test_complete', { score: result.overall });
    renderResult(result);
    show('at-result');
    announce(`Attention ${result.overall}. ${bandOf(result.overall).label}.`);
    scrollToGame();
    const finished = run;
    import('./share.js?v=2')
      .then((m) => m.mountShare($('at-share'), { result, run: finished }))
      .catch(() => {
        /* the result still shows without sharing */
      });
    try {
      if (board && typeof board.offerJoin === 'function') board.offerJoin(finished, result);
    } catch (_) {
      /* the leaderboard is optional */
    }
  }

  function renderResult(result) {
    setText($('at-score'), String(result.overall));
    setText($('at-band'), bandOf(result.overall).label);
    $('at-result').dataset.band = bandOf(result.overall).key;

    const r = result.reaction;
    setText($('at-r-score'), String(r.score));
    setText($('at-r-raw'), `Median ${r.medianMs === null ? '–' : `${r.medianMs} ms`} · ${r.slow} slow · ${r.falseStarts} too soon`);
    const m = result.memory;
    setText($('at-m-score'), String(m.score));
    setText($('at-m-raw'), m.bestSpan ? `Longest row ${m.bestSpan} digits` : 'No row typed back right');
    const s = result.rules;
    setText($('at-s-score'), String(s.score));
    setText($('at-s-raw'), s.correct ? `${s.correct} of ${s.total} right · ${s.meanCorrectMs.toLocaleString('en-US')} ms mean` : `0 of ${s.total} right`);

    setText($('at-pct'), `Higher than about ${percentileOf(result.overall)}% of people`);

    const vs = $('at-vs');
    if (challenge) {
      const diff = result.overall - challenge.score;
      const who = challenge.by;
      let line;
      if (diff > 0) line = who ? `You beat ${who} by ${diff}` : `You beat the ${challenge.score} by ${diff}`;
      else if (diff < 0) line = who ? `${who} is still ahead by ${-diff}` : `The ${challenge.score} is still ahead by ${-diff}`;
      else line = who ? `You tied with ${who}` : `You tied the ${challenge.score}`;
      vs.textContent = line;
      vs.hidden = false;
    } else {
      vs.hidden = true;
    }
  }

  // ---------- Part 1: reaction ----------

  const pad = $('at-pad');
  const padLabel = $('at-pad-label');
  const lastList = $('at-last-list');

  function startReaction() {
    const engine = new ReactionRun(performance.now());
    const last = [];
    const clock = $('at-reaction-clock');
    pad.dataset.state = 'wait';
    setText(padLabel, 'Wait for the dot…');
    renderLast();
    show('at-reaction');

    function renderLast() {
      const items = lastList.children;
      for (let i = 0; i < 3; i += 1) setText(items[i], last[i] === undefined ? '–' : `${last[i]} ms`);
    }

    function render(now) {
      setText(clock, clockText(engine.remaining(now)));
      if (engine.stage.kind === 'dotShowing') {
        pad.dataset.state = 'dot';
        setText(padLabel, 'Tap!');
        return;
      }
      const fb = engine.feedback(now);
      if (fb) {
        pad.dataset.state = fb.kind === 'reaction' ? 'result' : fb.kind;
        setText(padLabel, fb.kind === 'reaction' ? `${Math.round(fb.ms)} ms` : fb.kind === 'tooEarly' ? 'Too soon' : 'Missed');
        return;
      }
      pad.dataset.state = 'wait';
      setText(padLabel, 'Wait for the dot…');
    }

    active = {
      kind: 'reaction',
      frame(ts) {
        const handled = engine.advance(ts);
        if (engine.isOver) {
          pad.dataset.state = 'wait';
          setText(padLabel, 'Done');
          partDone('reaction', engine.result());
          return;
        }
        if (handled.includes('showDot')) announce('Tap!');
        if (handled.includes('timeOut')) announce('Missed');
        render(ts);
      },
      press(t) {
        const out = engine.pressed(t);
        if (out.kind === 'answered') {
          last.unshift(Math.round(out.ms));
          last.length = Math.min(last.length, 3);
          renderLast();
          announce(`${Math.round(out.ms)} ms`);
        } else if (out.kind === 'falseStart') {
          announce('Too soon');
        }
        if (out.kind !== 'ignored') render(t);
      },
      key(e, t) {
        if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (!e.repeat) this.press(t);
        }
      },
      abort() {},
    };
    startLoop();
  }

  pad.addEventListener('pointerdown', (e) => {
    if (!active || active.kind !== 'reaction') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    active.press(eventTime(e));
  });
  for (const type of ['contextmenu', 'dblclick', 'selectstart']) pad.addEventListener(type, (e) => e.preventDefault());
  // Touch moves on the pad never scroll the page mid-test.
  pad.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---------- Part 2: digit memory ----------

  const memRow = $('at-mem-row');
  const memCaption = $('at-mem-caption');
  const memBoard = $('at-mem-board');
  const keypad = $('at-keypad');
  const keys = Array.from(keypad.querySelectorAll('button'));

  function setKeypad(enabled) {
    if (keypad.classList.contains('is-idle') === !enabled) return;
    keypad.classList.toggle('is-idle', !enabled);
    for (const k of keys) setIdle(k, !enabled);
  }

  function startMemory() {
    const clock = $('at-memory-clock');
    const readyUntil = performance.now() + 1000;
    let engine = null;
    let lastView = '';
    memBoard.dataset.state = 'ready';
    memRow.replaceChildren();
    setText(memCaption, 'Get ready');
    setText(clock, clockText(MEMORY.durationSeconds * 1000));
    setKeypad(false);
    show('at-memory');

    function slots(values, count) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i += 1) {
        const span = document.createElement('span');
        span.className = values[i] === undefined ? 'at-slot is-empty' : 'at-slot';
        span.textContent = values[i] === undefined ? '' : String(values[i]);
        frag.appendChild(span);
      }
      memRow.replaceChildren(frag);
    }

    function render(now) {
      setText(clock, clockText(engine.remaining(now)));
      const phase = engine.phase;
      const view = `${phase}|${engine.digits.join('')}|${engine.entered.join('')}`;
      if (view === lastView) return;
      lastView = view;
      memBoard.dataset.state = phase;
      if (phase === 'showing') {
        slots(engine.digits, engine.digits.length);
        setText(memCaption, `Remember these · ${engine.digits.length} digits`);
        memRow.setAttribute('aria-hidden', 'true');
        announce(`Remember: ${engine.digits.join(' ')}`);
        setKeypad(false);
      } else if (phase === 'entering') {
        slots(engine.entered, engine.digits.length);
        setText(memCaption, engine.entered.length ? `${engine.entered.length} of ${engine.digits.length}` : 'Type them back');
        if (!engine.entered.length) announce(`Type the ${engine.digits.length} digits`);
        setKeypad(true);
      } else if (phase === 'feedback' && engine.lastAnswer) {
        const right = engine.lastAnswer.correct;
        slots(engine.lastAnswer.row, engine.lastAnswer.row.length);
        memBoard.dataset.state = right ? 'right' : 'wrong';
        setText(memCaption, right ? 'Right' : 'Wrong');
        announce(right ? 'Right' : 'Wrong');
        setKeypad(false);
      }
    }

    active = {
      kind: 'memory',
      frame(ts) {
        if (!engine) {
          if (ts < readyUntil) return;
          engine = new MemoryRun(ts);
        }
        engine.advance(ts);
        if (engine.isFinished) {
          setKeypad(false);
          partDone('memory', engine.result());
          return;
        }
        render(ts);
      },
      digit(d, t) {
        if (!engine) return;
        engine.type(d, t);
        if (engine.isFinished) return; // the next frame hands over
        render(t);
      },
      del(t) {
        if (!engine) return;
        if (engine.deleteLast(t)) render(t);
      },
      key(e, t) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          if (!e.repeat) this.digit(Number(e.key), t);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          this.del(t);
        }
      },
      abort() {
        setKeypad(false);
      },
    };
    startLoop();
  }

  keypad.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !active || active.kind !== 'memory' || button.getAttribute('aria-disabled') === 'true') return;
    const t = eventTime(e);
    if (button.dataset.del) active.del(t);
    else active.digit(Number(button.dataset.digit), t);
  });

  // ---------- Part 3: rule switch ----------

  const ansLeft = $('at-ans-left');
  const ansRight = $('at-ans-right');
  const ruleQ = $('at-rule-question');
  const ruleDigit = $('at-rule-digit');

  function startRules() {
    const steps = planSteps();
    const count = $('at-rules-count');
    const readyUntil = performance.now() + 1000;
    let engine = null;
    let lastIndex = -1;
    setText(count, `1 of ${RULES.trials}`);
    setText(ruleQ, 'Get ready');
    setText(ruleDigit, '');
    setText($('at-ans-left-label'), 'Odd');
    setText($('at-ans-right-label'), 'Even');
    setIdle(ansLeft, true);
    setIdle(ansRight, true);
    show('at-rules');

    function render() {
      setText(count, `${Math.max(1, engine.number)} of ${engine.count}`);
      const step = engine.current;
      const index = step ? engine.stage.index : -1;
      if (index === lastIndex) return;
      lastIndex = index;
      if (step) {
        const labels = ruleLabels(step.rule);
        setText(ruleQ, ruleQuestion(step.rule));
        setText(ruleDigit, String(step.digit));
        setText($('at-ans-left-label'), labels.left);
        setText($('at-ans-right-label'), labels.right);
        setIdle(ansLeft, false);
        setIdle(ansRight, false);
        announce(`${ruleQuestion(step.rule)} ${step.digit}`);
      } else {
        setText(ruleQ, ' ');
        setText(ruleDigit, '');
        setIdle(ansLeft, true);
        setIdle(ansRight, true);
      }
    }

    active = {
      kind: 'rules',
      frame(ts) {
        if (!engine) {
          if (ts < readyUntil) return;
          engine = new RulesRun(steps, ts);
        }
        engine.advance(ts);
        if (engine.isOver) {
          setIdle(ansLeft, true);
          setIdle(ansRight, true);
          partDone('rules', engine.result());
          return;
        }
        render();
      },
      answer(side, t) {
        if (!engine || !engine.current) return;
        const trial = engine.answered(side, t);
        if (trial) {
          const btn = side === 'left' ? ansLeft : ansRight;
          btn.classList.add('is-pressed');
          setTimeout(() => btn.classList.remove('is-pressed'), 150);
        }
        if (engine.isOver) return;
        render();
      },
      key(e, t) {
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        let side = null;
        if (k === 'f' || k === 'ArrowLeft') side = 'left';
        if (k === 'j' || k === 'ArrowRight') side = 'right';
        if (!side) return;
        e.preventDefault();
        if (!e.repeat) this.answer(side, t);
      },
      abort() {},
    };
    startLoop();
  }

  for (const btn of [ansLeft, ansRight]) {
    btn.addEventListener('pointerdown', (e) => {
      if (!active || active.kind !== 'rules') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      active.answer(btn.dataset.side, eventTime(e));
    });
    // Keyboard activation (Enter or Space on a focused button) arrives as a click with no pointer.
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0 || !active || active.kind !== 'rules') return;
      active.answer(btn.dataset.side, eventTime(e));
    });
  }

  // ---------- Global input ----------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (active) {
      active.key(e, eventTime(e));
      return;
    }
    // On a "Part n of 3" card, Space or Enter starts when the focus isn't on a control.
    const inter = $('at-inter');
    if (!inter.hidden && (e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        startPart();
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) abortPart('You left the page, so this part starts again from the beginning.');
  });

  window.addEventListener('beforeunload', (e) => {
    if (!inTest) return;
    e.preventDefault();
    e.returnValue = '';
  });

  $('at-start').addEventListener('click', startTest);
  $('at-inter-start').addEventListener('click', startPart);
  $('at-again').addEventListener('click', startTest);
  $('at-retry').addEventListener('click', startTest);

  // ---------- Leaderboard ----------

  const boardEl = $('at-board');
  if (boardEl) {
    import('./board.js?v=2')
      .then((m) => {
        board = m.mountBoard(boardEl) || null;
      })
      .catch(() => {
        /* the game works without the leaderboard */
      });
  }

}
