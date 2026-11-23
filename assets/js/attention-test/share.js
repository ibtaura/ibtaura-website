// Clarus Attention Test: the share block on the result screen.
//
// mountShare(el, { result, run }) fills an empty element with: an optional name field, a preview of the
// story card, "Share my score" (Web Share API with the 1080x1920 PNG where the browser can share files,
// otherwise a panel of X / LinkedIn / WhatsApp / Facebook / download / copy link), and "Challenge a friend".
// No login is needed. Styles: /assets/css/attention-share.css.
//
// Every share link points at adarna.us/attention-test/s/SCORE (plus ?by=NAME, &f=FRIENDCODE and &l=LEVEL), a
// static page whose og:image shows the score (made by scripts/build-attention-share.py) and which forwards to the
// game. l is the level (easy | hard) so the friend plays the same one; it's left out for normal to keep links short.
// One leaderboard for all levels: result.overall already includes the level bonus (result.bonus, Hard +10, Easy -10).
// The user's name only ever goes into textContent, canvas text and encoded URL parameters.
// f is the sharer's friend code for the friends leaderboard. board.js stores it in localStorage while the
// sharer is signed in; it's read at the moment of sharing (they may sign in after the result screen shows).

import { bandOf, percentileOf } from './scoring.js?v=2';
import { track } from './track.js?v=1';

const ORIGIN = 'https://adarna.us';
const NAME_KEY = 'clarus.attentionTest.shareName';
const NAME_MAX = 24;
export const FRIEND_CODE_KEY = 'clarus.attentionTest.friendCode';
export const FRIEND_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
// Control characters, zero-width and bidi-override characters.
const BAD_CHARS = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]', 'g');
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
const C = {
  bg: '#f5f5f7',
  white: '#ffffff',
  ink: '#1d1d1f',
  grey: '#6e6e73',
  light: '#86868b',
  green: '#34C759',
  orange: '#FF6B35',
  dotOff: '#c7c7cc',
};
// Own copy of the level labels (scoring.js has LEVELS too) so sharing never depends on load order.
export const LEVEL_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const LEVEL_DOTS = { easy: 1, normal: 2, hard: 3 };
const FOOTER_URL = 'adarna.us/attention-test';
const FOOTER_BRAND = 'Clarus Health by Adarna Inc.';

// ---------- data

/** Trims, drops control characters, collapses spaces and caps the length. */
export function cleanName(raw) {
  return String(raw || '')
    .replace(BAD_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** The friend code when it's valid (8 chars of the unambiguous alphabet), else ''. */
export function cleanFriendCode(raw) {
  return typeof raw === 'string' && FRIEND_CODE_RE.test(raw) ? raw : '';
}

/** The signed-in sharer's friend code from localStorage (set by board.js), or '' when absent or invalid. */
export function loadFriendCode() {
  try {
    return cleanFriendCode(localStorage.getItem(FRIEND_CODE_KEY));
  } catch (_) {
    return '';
  }
}

/** 'easy' | 'normal' | 'hard'; anything else (missing, unknown, wrong type) is 'normal'. */
export function cleanLevel(raw) {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_LABELS, raw) ? raw : 'normal';
}

/**
 * The challenge link adarna.us/attention-test/s/SCORE (https), plus ?by=NAME when a name is given,
 * f=CODE when a valid friend code is given and l=LEVEL for easy or hard (normal is the default, so it's left out):
 * /s/118?by=Maya&f=abcd2345&l=hard, /s/118?f=abcd2345, /s/118?l=easy or /s/118.
 */
export function shareUrl(score, name, friendCode, level) {
  const n = cleanName(name);
  const f = cleanFriendCode(friendCode);
  const l = cleanLevel(level);
  const params = [];
  if (n) params.push(`by=${encodeURIComponent(n)}`);
  if (f) params.push(`f=${f}`);
  if (l !== 'normal') params.push(`l=${l}`);
  return `${ORIGIN}/attention-test/s/${score}${params.length ? `?${params.join('&')}` : ''}`;
}

export function shareText(score, level) {
  const label = LEVEL_LABELS[cleanLevel(level)];
  return `I scored ${score} on ${label} on the Clarus Attention Test (sharper than ${percentileOf(score)}% of people). Can you beat me? \u{1F9E0}`;
}

/**
 * The message that goes with a shared image: the score line plus the link, inside the text. Many apps
 * (WhatsApp, Instagram, Telegram) drop the separate url field when a file is attached, so the link must be
 * in the text. A link with a friend code (f=) also invites the reader to the sharer's Friends board.
 */
export function shareMessage(score, level, url) {
  const invite = /[?&]f=/.test(String(url)) ? 'Play and join my Friends board' : 'Play here';
  return `${shareText(score, level)}

${invite}: ${url}`;
}

/** The numbers the cards show, from scoreRun()'s result. `level` defaults to result.level. */
export function cardData(result, name, level) {
  const score = result.overall;
  const lvl = cleanLevel(level ?? result.level);
  const bonus = Number.isFinite(result.bonus) ? result.bonus : 0;
  const r = result.reaction || {};
  const m = result.memory || {};
  const ru = result.rules || {};
  return {
    score,
    band: bandOf(score).label,
    pct: percentileOf(score),
    name: cleanName(name),
    level: lvl,
    levelLabel: LEVEL_LABELS[lvl],
    bonus,
    // A score-only result (a best score saved before part data was kept) shows what each part tests instead.
    parts: [
      { label: 'Reaction', score: r.score, detail: Number.isFinite(r.medianMs) ? `${r.medianMs} ms` : '', hint: 'Tap the dot' },
      { label: 'Memory', score: m.score, detail: Number.isFinite(m.bestSpan) ? `${m.bestSpan} digits` : '', hint: 'Recall digits' },
      { label: 'Rules', score: ru.score, detail: Number.isFinite(ru.total) ? `${ru.correct}/${ru.total} right` : '', hint: 'Switch fast' },
    ],
  };
}

function altText(d) {
  const parts = d.parts.map((p) => (Number.isFinite(p.score) ? `${p.label} ${p.score}` : p.label)).join(', ');
  const bonus = d.bonus > 0 ? ` including a ${d.bonus}-point ${d.levelLabel} bonus` : '';
  return `Attention Test score card: ${d.score} on ${d.levelLabel}${bonus}, ${d.band}, sharper than ${d.pct}% of people. ${parts}.`;
}

// ---------- canvas drawing

const font = (weight, size) => `${weight} ${size}px ${FONT_STACK}`;

function widthOf(ctx, text, tracking = 0) {
  if (!tracking) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

/** Sets the largest font at or below `size` that fits `text` into maxW. */
function fitFont(ctx, text, weight, size, maxW, tracking = 0) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > 10 && widthOf(ctx, text, tracking) > maxW) {
    s -= 1;
    ctx.font = font(weight, s);
  }
  return s;
}

/** Fills text at (x, y) on the alphabetic baseline; align 'left' | 'center' | 'right'. */
function fillText(ctx, text, x, y, { weight = 400, size, maxW, color, align = 'left', tracking = 0 }) {
  fitFont(ctx, text, weight, size, maxW, tracking);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const w = widthOf(ctx, text, tracking);
  let left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (!tracking) {
    ctx.textAlign = 'left';
    ctx.fillText(text, left, y);
    return w;
  }
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, left, y);
    left += ctx.measureText(ch).width + tracking;
  }
  return w;
}

function roundRect(ctx, x, y, w, h, r, color) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function dot(ctx, cx, cy, r, color = C.green) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const scoredLine = (d) => (d.name ? `${d.name} scored` : 'I scored');

/** Kicker: green dot + letter-spaced "ATTENTION TEST". (x, y) is the dot's left edge and the text baseline. Returns its width. */
function kicker(ctx, x, y, size, align = 'left', maxW = 600) {
  const tracking = size * 0.17;
  const r = size * 0.36;
  const gap = size * 0.55;
  fitFont(ctx, 'ATTENTION TEST', 600, size, maxW, tracking);
  const tw = widthOf(ctx, 'ATTENTION TEST', tracking);
  const total = r * 2 + gap + tw;
  const left = align === 'center' ? x - total / 2 : x;
  dot(ctx, left + r, y - size * 0.36, r);
  fillText(ctx, 'ATTENTION TEST', left + r * 2 + gap, y, { weight: 600, size, maxW, color: C.light, tracking });
  return total;
}

/** Pill texts from longest to shortest: "HARD · +10 BONUS", "HARD +10", "HARD" (no bonus: just the level). */
const pillTexts = (d) => {
  const label = d.levelLabel.toUpperCase();
  return d.bonus > 0 ? [`${label} · +${d.bonus} BONUS`, `${label} +${d.bonus}`, label] : [label];
};

/**
 * Level pill: three intensity dots (1 filled = Easy, 2 = Normal, 3 = Hard) and the letter-spaced level name,
 * plus the bonus when the level added points. Uses the longest text that fits maxW without shrinking much.
 * (x, cy) is the pill's left edge (its centre with align 'center') and vertical centre; returns its width.
 */
function levelPill(ctx, d, x, cy, h, align = 'left', maxW = 600) {
  const r = h * 0.1;
  const step = r * 3.1;
  const padX = h * 0.42;
  const dotsW = r * 2 + step * 2;
  const gap = h * 0.28;
  const want = Math.round(h * 0.42);
  const room = maxW - padX * 2 - dotsW - gap;
  const texts = pillTexts(d);
  let text = texts[0];
  let size = want;
  for (const t of texts) {
    text = t;
    size = fitFont(ctx, t, 700, want, room, want * 0.14);
    if (size >= want * 0.9) break;
  }
  const tracking = size * 0.14;
  const tw = widthOf(ctx, text, tracking);
  const w = padX * 2 + dotsW + gap + tw;
  const left = align === 'center' ? x - w / 2 : x;
  roundRect(ctx, left, cy - h / 2, w, h, h / 2, C.bg);
  const filled = LEVEL_DOTS[d.level] || 2;
  for (let i = 0; i < 3; i++) dot(ctx, left + padX + r + i * step, cy, r, i < filled ? C.ink : C.dotOff);
  fillText(ctx, text, left + padX + dotsW + gap, cy + size * 0.36, { weight: 700, size, maxW: tw + 1, color: C.ink, tracking });
  return w;
}

/** 1080x1920 card for Instagram / WhatsApp stories. Key content stays between y 250 and 1670 (story UI). */
export function drawStoryCard(d) {
  const W = 1080;
  const canvas = canvasOf(W, 1920);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, 1920);
  const cx = W / 2;

  kicker(ctx, cx, 300, 34, 'center', 800);

  roundRect(ctx, 72, 350, 936, 720, 56, C.white);
  levelPill(ctx, d, cx, 432, 68, 'center', 800);
  fillText(ctx, scoredLine(d), cx, 540, { weight: 600, size: 52, maxW: 800, color: C.ink, align: 'center' });
  fillText(ctx, String(d.score), cx, 832, { weight: 700, size: 340, maxW: 820, color: C.ink, align: 'center' });
  fillText(ctx, d.band, cx, 934, { weight: 700, size: 72, maxW: 820, color: C.ink, align: 'center' });
  fillText(ctx, `Sharper than ${d.pct}% of people`, cx, 1006, { weight: 400, size: 44, maxW: 820, color: C.grey, align: 'center' });

  const tw = 296;
  d.parts.forEach((p, i) => {
    const x = 72 + i * (tw + 24);
    const tcx = x + tw / 2;
    roundRect(ctx, x, 1100, tw, 280, 40, C.white);
    ctx.font = font(600, 32);
    const lw = Math.min(widthOf(ctx, p.label), tw - 80);
    dot(ctx, tcx - lw / 2 - 20, 1165 - 11, 9);
    fillText(ctx, p.label, tcx + 10, 1165, { weight: 600, size: 32, maxW: tw - 80, color: C.grey, align: 'center' });
    if (!Number.isFinite(p.score)) {
      fillText(ctx, p.hint, tcx, 1290, { weight: 600, size: 38, maxW: tw - 40, color: C.ink, align: 'center' });
      return;
    }
    fillText(ctx, String(p.score), tcx, 1300, { weight: 700, size: 112, maxW: tw - 40, color: C.ink, align: 'center' });
    if (p.detail) fillText(ctx, p.detail, tcx, 1350, { weight: 400, size: 30, maxW: tw - 40, color: C.light, align: 'center' });
  });

  const cta = 'Can you beat me?';
  const cs = fitFont(ctx, cta, 700, 60, 760);
  const cw = widthOf(ctx, cta) + 120;
  roundRect(ctx, cx - cw / 2, 1420, cw, 104, 52, C.orange);
  fillText(ctx, cta, cx, 1420 + 52 + cs * 0.35, { weight: 700, size: cs, maxW: 760, color: C.white, align: 'center' });

  fillText(ctx, FOOTER_URL, cx, 1600, { weight: 600, size: 40, maxW: 900, color: C.ink, align: 'center' });
  fillText(ctx, FOOTER_BRAND, cx, 1652, { weight: 400, size: 32, maxW: 900, color: C.light, align: 'center' });
  return canvas;
}

/** 1200x630 card for X, LinkedIn and Facebook posts; the same layout as the generated og images. */
export function drawPostCard(d) {
  const canvas = canvasOf(1200, 630);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, 1200, 630);
  roundRect(ctx, 40, 40, 1120, 550, 36, C.white);

  const left = 104;
  const colW = 520;
  const kw = kicker(ctx, left, 112, 24, 'left', colW);
  // right edge 640: 40 px clear of the part tiles
  levelPill(ctx, d, left + kw + 20, 104, 40, 'left', 640 - (left + kw + 20));
  fillText(ctx, scoredLine(d), left, 172, { weight: 600, size: 32, maxW: colW, color: C.ink });
  fillText(ctx, String(d.score), left - 6, 352, { weight: 700, size: 200, maxW: colW, color: C.ink });
  fillText(ctx, d.band, left, 420, { weight: 700, size: 40, maxW: colW, color: C.ink });
  fillText(ctx, `Sharper than ${d.pct}% of people`, left, 466, { weight: 400, size: 28, maxW: colW, color: C.grey });

  const x0 = 680;
  const x1 = 1096;
  let y = 96;
  for (const p of d.parts) {
    roundRect(ctx, x0, y, x1 - x0, 104, 24, C.bg);
    dot(ctx, x0 + 35, y + 52, 7);
    const hasDetail = Boolean(p.detail);
    fillText(ctx, p.label, x0 + 60, y + (hasDetail ? 50 : 63), { weight: 700, size: 30, maxW: 200, color: C.ink });
    if (hasDetail) fillText(ctx, p.detail, x0 + 60, y + 82, { weight: 400, size: 22, maxW: 200, color: C.grey });
    if (Number.isFinite(p.score)) fillText(ctx, String(p.score), x1 - 28, y + 70, { weight: 700, size: 52, maxW: 130, color: C.ink, align: 'right' });
    else fillText(ctx, p.hint, x1 - 28, y + 63, { weight: 400, size: 24, maxW: 180, color: C.grey, align: 'right' });
    y += 120;
  }

  const cta = 'Can you beat me?';
  const cs = fitFont(ctx, cta, 700, 34, x1 - x0 - 64);
  const cw = widthOf(ctx, cta) + 64;
  roundRect(ctx, x0, 462, cw, 72, 36, C.orange);
  fillText(ctx, cta, x0 + 32, 498 + cs * 0.35, { weight: 700, size: cs, maxW: x1 - x0 - 64, color: C.white });

  const footer = `${FOOTER_URL} · ${FOOTER_BRAND}`;
  fillText(ctx, footer, left, 548, { weight: 400, size: 20, maxW: colW, color: C.light });
  return canvas;
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

async function fontsReady() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {
    /* draw with whatever is loaded */
  }
}

// ---------- small DOM helpers

function h(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  if (text != null) node.textContent = text;
  return node;
}

function loadName() {
  try {
    return cleanName(localStorage.getItem(NAME_KEY));
  } catch (_) {
    return '';
  }
}

function saveName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch (_) {
    /* private mode or blocked storage: the name just isn't remembered */
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const ta = h('textarea', { readonly: true, 'aria-hidden': 'true' });
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch (_) {
    /* fall through */
  }
  return false;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let uid = 0;

// ---------- the share block

/**
 * Renders the share block into `el` (emptied first). Only call it with a valid result.
 * Returns { update(name), destroy() } and a `ready` promise that resolves once the first cards are drawn.
 */
export function mountShare(el, { result, run } = {}) {
  if (!el || !result || !result.valid || !Number.isFinite(result.overall)) return null;
  const score = result.overall;
  const level = cleanLevel(result.level ?? (run && run.level));
  const id = `ats-${++uid}`;
  let name = loadName();
  let story = null; // { blob, file }
  let post = null; // { blob }
  let previewUrl = null;
  let drawToken = 0;
  let toastTimer = 0;
  let nameTimer = 0;

  el.replaceChildren();
  const root = h('section', { class: 'ats', 'aria-labelledby': `${id}-title` });
  root.appendChild(h('h2', { class: 'ats-title', id: `${id}-title` }, 'Share your score'));

  // name field
  const field = h('div', { class: 'ats-field' });
  field.appendChild(h('label', { class: 'ats-label', for: `${id}-name` }, 'Your name on the card (optional)'));
  const input = h('input', {
    class: 'ats-input',
    id: `${id}-name`,
    type: 'text',
    maxlength: String(NAME_MAX),
    autocomplete: 'nickname',
    spellcheck: 'false',
    enterkeyhint: 'done',
    placeholder: 'First name or nickname',
  });
  input.value = name;
  field.appendChild(input);
  root.appendChild(field);

  // preview
  const figure = h('figure', { class: 'ats-preview' });
  const img = h('img', { class: 'ats-preview-img', width: '1080', height: '1920', alt: '', decoding: 'async' });
  img.alt = altText(cardData(result, name, level));
  figure.appendChild(img);
  root.appendChild(figure);

  // main buttons
  const actions = h('div', { class: 'ats-actions' });
  const shareBtn = h('button', { class: 'ats-btn ats-btn-primary', type: 'button', 'aria-expanded': 'false', 'aria-controls': `${id}-panel` }, 'Share my score');
  const challengeBtn = h('button', { class: 'ats-btn ats-btn-ghost', type: 'button' }, 'Challenge a friend');
  actions.append(shareBtn, challengeBtn);
  root.appendChild(actions);

  // fallback panel
  const panel = h('div', { class: 'ats-panel', id: `${id}-panel`, role: 'group', 'aria-label': 'Share options', hidden: true });
  const link = (cls, label, method) => {
    const a = h('a', { class: `ats-opt ${cls}`, target: '_blank', rel: 'noopener noreferrer' }, label);
    a.addEventListener('click', () => {
      updateLinks(); // picks up a friend code saved since the links were built; runs before the browser follows href
      track('share', { method });
    });
    return a;
  };
  const xLink = link('ats-opt-x', 'X', 'x');
  const liLink = link('ats-opt-linkedin', 'LinkedIn', 'linkedin');
  const waLink = link('ats-opt-whatsapp', 'WhatsApp', 'whatsapp');
  const fbLink = link('ats-opt-facebook', 'Facebook', 'facebook');
  const dlStory = h('button', { class: 'ats-opt ats-opt-download', type: 'button' }, 'Story image');
  const dlPost = h('button', { class: 'ats-opt ats-opt-download', type: 'button' }, 'Post image');
  const copyBtn = h('button', { class: 'ats-opt ats-opt-copy', type: 'button' }, 'Copy link');
  const socials = h('div', { class: 'ats-opt-row' });
  socials.append(xLink, liLink, waLink, fbLink);
  const downloads = h('div', { class: 'ats-opt-row ats-opt-row-download' });
  downloads.append(h('span', { class: 'ats-opt-caption' }, 'Download image'), dlStory, dlPost);
  panel.append(socials, downloads, copyBtn);
  root.appendChild(panel);

  const toast = h('p', { class: 'ats-toast', role: 'status', 'aria-live': 'polite' });
  root.appendChild(toast);
  el.appendChild(root);

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 3200);
  }

  // The link as of now: the friend code is read on every share, not once at mount.
  const currentUrl = () => shareUrl(score, name, loadFriendCode(), level);

  function updateLinks() {
    const url = currentUrl();
    const text = shareText(score, level);
    xLink.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    liLink.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    waLink.href = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url);
    fbLink.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
  }

  async function draw() {
    const token = ++drawToken;
    await fontsReady();
    if (token !== drawToken) return;
    const d = cardData(result, name, level);
    const [sBlob, pBlob] = await Promise.all([canvasBlob(drawStoryCard(d)), canvasBlob(drawPostCard(d))]);
    if (token !== drawToken) return;
    let file = null;
    try {
      file = new File([sBlob], `clarus-attention-${score}-${level}.png`, { type: 'image/png' });
    } catch (_) {
      /* old browsers without the File constructor: no native file share */
    }
    story = { blob: sBlob, file };
    post = { blob: pBlob };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(sBlob);
    img.src = previewUrl;
    img.alt = altText(d);
  }

  function canShareFile() {
    try {
      return Boolean(story && story.file && navigator.canShare && navigator.canShare({ files: [story.file] }));
    } catch (_) {
      return false;
    }
  }

  function openPanel() {
    panel.hidden = false;
    shareBtn.setAttribute('aria-expanded', 'true');
  }

  shareBtn.addEventListener('click', async () => {
    track('share_open');
    updateLinks();
    // The story file is drawn ahead of time, so share() runs inside the tap (Safari needs that).
    if (canShareFile()) {
      try {
        // No separate url: the link sits in the text, which apps keep alongside the image.
        await navigator.share({ files: [story.file], title: 'Clarus Attention Test', text: shareMessage(score, level, currentUrl()) });
        track('share', { method: 'native' });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the visitor closed the share sheet
      }
    }
    if (panel.hidden) {
      openPanel();
      xLink.focus();
    } else {
      panel.hidden = true;
      shareBtn.setAttribute('aria-expanded', 'false');
    }
  });

  challengeBtn.addEventListener('click', async () => {
    const url = currentUrl();
    if (await copyText(url)) {
      track('challenge_copy');
      showToast('Link copied — send it to someone who thinks they’re sharper');
    } else {
      window.prompt('Copy this link and send it to a friend:', url);
    }
  });

  copyBtn.addEventListener('click', async () => {
    const url = currentUrl();
    if (await copyText(url)) {
      track('share', { method: 'copy' });
      showToast('Link copied');
    } else {
      window.prompt('Copy this link:', url);
    }
  });

  const download = (which) => async () => {
    try {
      if (!story || !post) await draw();
      const blob = which === 'story' ? story.blob : post.blob;
      downloadBlob(blob, `clarus-attention-${score}-${level}-${which}.png`);
      track('share', { method: 'download', size: which });
    } catch (_) {
      showToast('Sorry, the image could not be made in this browser');
    }
  };
  dlStory.addEventListener('click', download('story'));
  dlPost.addEventListener('click', download('post'));

  input.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => update(input.value), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });

  function update(raw) {
    const next = cleanName(raw);
    if (next === name) return Promise.resolve();
    name = next;
    saveName(name);
    updateLinks();
    return draw().catch(() => {});
  }

  updateLinks();
  const ready = draw().catch(() => {
    figure.hidden = true; // canvas blocked: sharing links still work
  });

  return {
    ready,
    update,
    destroy() {
      clearTimeout(toastTimer);
      clearTimeout(nameTimer);
      drawToken += 1;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      el.replaceChildren();
    },
  };
}
