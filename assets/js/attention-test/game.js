// Clarus Attention Test: screens, flow, timers and input. The rules live in the pure engines
// (reaction.js, memory.js, rules.js) and the scoring in scoring.js; this file only drives them.
//
// Timing: one requestAnimationFrame loop runs while a part is on screen. Each frame passes its timestamp to the
// engine, so a dot or digit is timed from the frame that first paints it. Presses use the event's own timestamp
// (the same clock as performance.now()), falling back to performance.now().

import { MEMORY, RULES, LEVELS, DEFAULT_LEVEL, scoreRun, checkRun, percentileOf, bandOf } from './scoring.js?v=2';
import { track } from './track.js?v=2';
import { ReactionRun, dotLayout } from './reaction.js?v=2';
import { MemoryRun } from './memory.js?v=2';
import { RulesRun, planSteps, ruleQuestion, ruleLabels } from './rules.js?v=2';
import { saveRun, loadStored, clearStored, canJoin, agoText } from './stored.js?v=1';

const $ = (id) => document.getElementById(id);
const game = $('at-game');
if (game) init();

function init() {
  const device = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = $('at-live');
  const screens = Array.from(game.querySelectorAll('.at-screen'));

  const seconds = (ms) => `${String(ms / 1000)} ${ms === 1000 ? 'second' : 'seconds'}`;

  // One level for everyone (Normal in scoring.js): the Easy / Hard picker was removed on 23 Nov 2026 so every
  // run gets one comparable score. scoring.js and the server still know the old levels, so older runs and
  // links stay valid; this page only ever plays DEFAULT_LEVEL.
  const RULES_COPY = {
    normal: { rules: 'odd or even, lower or higher than a number, or a multiple of 3', items: 'numbers' },
  };

  const PARTS = [
    {
      key: 'reaction',
      name: 'Reaction',
      title: 'Tap the green dot',
      text: (lv) => {
        const dot = LEVELS[lv].reactionDot;
        const what = `the green dot appears ${dot.position === 'center' ? 'in the middle' : 'somewhere on the pad'}`;
        return device === 'phone'
          ? `Tap the pad as soon as ${what}. It runs for 45 seconds; taps before the dot count as too soon.`
          : `Click the pad, or press Space, as soon as ${what}. It runs for 45 seconds; presses before the dot count as too soon.`;
      },
      start: startReaction,
    },
    {
      key: 'memory',
      name: 'Digit memory',
      title: 'Remember the digits',
      text: (lv) =>
        `A row of ${LEVELS[lv].memoryStartLength} digits shows for ${seconds(LEVELS[lv].memoryShowPerDigitMs)} a digit, then hides. ` +
        (device === 'phone' ? 'Type it back on the keypad.' : 'Type it back with the number keys or the keypad.') +
        ' Each right answer adds a digit. 45 seconds.',
      start: startMemory,
    },
    {
      key: 'rules',
      name: 'Rule switch',
      title: 'Follow the rule',
      text: (lv) =>
        `Answer each number by the rule above it: ${RULES_COPY[lv].rules}.` +
        (device === 'phone' ? '' : ' Press F for the left button and J for the right.') +
        ` 10 ${RULES_COPY[lv].items}, ${seconds(LEVELS[lv].answerWindowMs)} each.`,
      start: startRules,
    },
  ];

  let run = null; // the raw run being built
  let partIndex = 0;
  let active = null; // the part on screen: { kind, frame(ts), key(e, t), abort() }
  let rafId = 0;
  let inTest = false;
  let board = null;
  let boardReady = Promise.resolve();
  const challenge = readChallenge();

  if (device === 'phone') game.classList.add('at-is-phone');

  // ---------- Helpers ----------

  function show(id) {
    for (const s of screens) s.hidden = s.id !== id;
    game.classList.toggle('is-intro', id === 'at-intro'); // the tiles show only on the intro
    // While a part runs, the leaderboard and FAQ step aside (owner, 23 Nov 2026); they come back on the
    // start screen and the result screen, where people join the board.
    // The leaderboard and FAQ step aside everywhere but the start screen (owner, 23-24 Nov 2026). On the
    // result screen the board's join card moves into the right-hand tile instead.
    document.body.classList.toggle('at-testing', id !== 'at-intro');
    placeNotice(id === 'at-result');
    const screen = $(id);
    const heading = screen && screen.querySelector('h1, h2');
    if (heading) heading.focus({ preventScroll: true });
  }

  // The board's notice slot (join card, "Saving…", "You're #N today") lives in the join tile while the
  // result shows and goes back to the top of the board otherwise. The tile shows only when the notice does.
  let noticeWatch = null;
  function syncJoin() {
    const n = $('at-join-slot').querySelector('.atb-notice');
    const on = Boolean(n) && !n.hidden;
    $('at-join-tile').hidden = !on;
    $('at-result-row').classList.toggle('is-single', !on);
  }
  function placeNotice(inResult) {
    const n = document.querySelector('#at-board .atb-notice, #at-join-slot .atb-notice');
    if (!n) return;
    if (inResult) {
      $('at-join-slot').append(n);
      if (!noticeWatch && 'MutationObserver' in window) {
        noticeWatch = new MutationObserver(syncJoin);
        noticeWatch.observe(n, { attributes: true, attributeFilter: ['hidden'] });
      }
    } else if (n.parentElement !== $('at-board')) {
      $('at-board').prepend(n);
    }
    syncJoin();
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

  const level = DEFAULT_LEVEL;

  // ---------- Flow ----------

  function startTest() {
    run = { v: 2, level, device };
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
    setText($('at-inter-text'), part.text(run.level));
    const noteEl = $('at-inter-note');
    noteEl.hidden = !note;
    noteEl.textContent = note || '';
    $('at-inter').dataset.part = part.key; // colours the square (attention-dark.css)
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
    try {
      saveRun(finished);
      renderStored();
    } catch (_) {
      /* browser memory is optional */
    }
    import('./share.js?v=10')
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
  const padCircle = $('at-pad-circle');
  const padLabel = $('at-pad-label');
  const lastList = $('at-last-list');
  // The band at the bottom of the pad that holds the label; dots are placed above it.
  const PAD_LABEL_BAND = 64;

  function startReaction() {
    const engine = new ReactionRun(performance.now());
    const dot = LEVELS[run.level].reactionDot;
    const last = [];
    const clock = $('at-reaction-clock');
    pad.dataset.state = 'wait';
    pad.dataset.dot = dot.position;
    setText(padLabel, 'Wait for the dot…');
    renderLast();
    show('at-reaction');
    placeDot();

    // Each dot gets its box before the frame that paints it green (a new random spot on Normal and Hard).
    function placeDot() {
      const box = dotLayout({ width: pad.clientWidth, height: pad.clientHeight - PAD_LABEL_BAND }, dot, Math.random);
      const style = padCircle.style;
      style.width = `${box.size}px`;
      style.height = `${box.size}px`;
      style.left = `${box.left}px`;
      style.top = `${box.top}px`;
    }

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
        if (handled.includes('showDot')) {
          placeDot();
          announce('Tap!');
        }
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
          engine = new MemoryRun(ts, Math.random, run.level);
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
    const steps = planSteps(run.level);
    const count = $('at-rules-count');
    const readyUntil = performance.now() + 1000;
    let engine = null;
    let lastIndex = -1;
    setText(count, `1 of ${RULES.trials}`);
    setText(ruleQ, 'Get ready');
    setText(ruleDigit, '');
    const firstLabels = ruleLabels(steps[0].rule);
    setText($('at-ans-left-label'), firstLabels.left);
    setText($('at-ans-right-label'), firstLabels.right);
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
        const question = ruleQuestion(step.rule, step.pivot);
        setText(ruleQ, question);
        setText(ruleDigit, String(step.n));
        setText($('at-ans-left-label'), labels.left);
        setText($('at-ans-right-label'), labels.right);
        setIdle(ansLeft, false);
        setIdle(ansRight, false);
        announce(`${question} ${step.n}`);
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
          engine = new RulesRun(steps, ts, run.level);
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

  // ---------- Browser memory: the best and last run on this device ----------
  // stored.js keeps the raw runs and re-scores them on every load; here they become a small card on the intro
  // with Share (the share card in a dialog) and, for runs under 7 days old, Put it on the leaderboard.

  const storedEl = $('at-stored');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionButton(text, className, onClick) {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  const storedScoreText = (entry) => String(entry.result.overall);
  const storedParams = (entry, which) => ({ score: entry.result.overall, which });

  function shareStored(entry, which) {
    track('stored_share', storedParams(entry, which));
    import('./share-dialog.js?v=7')
      .then((m) => m.openShareDialog({ result: entry.result, run: entry.run, title: which === 'best' ? 'Share your best score' : 'Share your last score' }))
      .catch(() => announce('Sharing is not available right now.'));
  }

  function scrollToElement(target) {
    const y = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 96); // the fixed nav bar
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

  function joinStored(entry, which) {
    track('stored_join', storedParams(entry, which));
    boardReady
      .then(() => {
        if (board && typeof board.offerJoin === 'function') board.offerJoin(entry.run, entry.result);
      })
      .catch(() => {
        /* the leaderboard is optional */
      });
    const section = $('at-board-section') || boardEl;
    if (section) scrollToElement(section);
  }

  function renderStored() {
    if (!storedEl) return;
    const { best, last } = loadStored();
    if (!best) {
      storedEl.hidden = true;
      storedEl.replaceChildren();
      return;
    }
    const now = Date.now();
    const head = el('p', 'at-stored-best');
    head.append(el('span', 'at-stored-label', 'Your best on this device'), el('strong', 'at-stored-score', storedScoreText(best)));
    const actions = el('div', 'at-stored-actions');
    actions.append(actionButton('Share \u203A', 'at-start-link', () => shareStored(best, 'best')));
    if (canJoin(best, now)) {
      actions.append(actionButton('Put it on the leaderboard \u203A', 'at-start-link', () => joinStored(best, 'best')));
    }
    const nodes = [head, actions];
    if (last) {
      const line = el('p', 'at-stored-last', `Last score ${storedScoreText(last)}, ${agoText(last.at, now)} `);
      const tail = el('span', 'at-nowrap', '· ');
      tail.append(actionButton('Share', 'at-link-btn', () => shareStored(last, 'last')));
      line.append(tail);
      nodes.push(line);
    }
    const forget = actionButton('Forget', 'at-link-btn at-stored-forget', () => {
      clearStored();
      track('stored_forget');
      renderStored();
      announce('Your saved scores on this device were removed.');
      $('at-start').focus({ preventScroll: true });
    });
    forget.setAttribute('aria-label', 'Forget the scores saved on this device');
    nodes.push(forget);
    storedEl.replaceChildren(...nodes);
    storedEl.hidden = false;
  }

  try {
    renderStored();
  } catch (_) {
    if (storedEl) storedEl.hidden = true;
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
  // The result tile's blue links press the share block's own buttons (share.js), which stay hidden.
  function pressShare(selector) {
    const b = $('at-share').querySelector(selector);
    if (!b) return;
    b.click();
    const panel = $('at-share').querySelector('.ats-panel');
    if (panel && !panel.hidden) panel.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  }
  $('at-share-link').addEventListener('click', () => pressShare('.ats-btn-primary'));
  $('at-challenge-link').addEventListener('click', () => pressShare('.ats-btn-ghost'));
  $('at-retry').addEventListener('click', startTest);

  // ---------- Leaderboard ----------

  const boardEl = $('at-board');
  if (boardEl) {
    boardReady = import('./board.js?v=18')
      .then((m) => {
        board = m.mountBoard(boardEl) || null;
        if (!$('at-result').hidden) placeNotice(true);
      })
      .catch(() => {
        /* the game works without the leaderboard */
      });
  }

}
