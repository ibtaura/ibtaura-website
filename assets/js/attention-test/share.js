// Clarus Attention Test: the share block on the result screen.
//
// mountShare(el, { result, run }) fills an empty element with: an optional name field, a preview of the
// story card, "Share my score" (Web Share API with the 1080x1920 PNG where the browser can share files,
// otherwise a panel of X / LinkedIn / WhatsApp / Facebook / download / copy link), and "Challenge a friend".
// No login is needed. Styles: /assets/css/attention-share.css.
//
// Every share link points at adarna.us/attention-test/s/SCORE (plus ?by=NAME and &f=FRIENDCODE), a static page
// whose og:image shows the score (made by scripts/build-attention-share.py) and which forwards to the game.
// One level, one score (23 Nov 2026): links no longer carry l=LEVEL and the cards and texts never name a level.
// cleanLevel / cardData.level stay for old saved runs; the game page ignores l= on links shared before.
// The user's name only ever goes into textContent, canvas text and encoded URL parameters.
// f is the sharer's friend code for the friends leaderboard. board.js stores it in localStorage while the
// sharer is signed in; it's read at the moment of sharing (they may sign in after the result screen shows).

import { bandOf, percentileOf } from './scoring.js?v=2';
import { track } from './track.js?v=2'; // same specifier everywhere, or the browser loads two copies

const ORIGIN = 'https://adarna.us';
const NAME_KEY = 'clarus.attentionTest.shareName';
const NAME_MAX = 24;
export const FRIEND_CODE_KEY = 'clarus.attentionTest.friendCode';
export const FRIEND_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
// Control characters, zero-width and bidi-override characters.
const BAD_CHARS = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]', 'g');
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
// Own copy of the level labels (scoring.js has LEVELS too) so sharing never depends on load order.
export const LEVEL_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const FOOTER_URL = 'adarna.us/attention-test';
const FOOTER_BRAND = 'Clarus Health by Adarna Inc.';

// ---------- data

// A high surrogate with no low one after it, or a low one with no high one before it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Drops lone surrogates and keeps at most `max` code points, so an emoji at the end is never cut in half
 * (String.slice counts UTF-16 units, and half an emoji makes encodeURIComponent throw).
 */
export function clampName(raw, max = NAME_MAX) {
  return [...String(raw ?? '').replace(LONE_SURROGATE, '')].slice(0, max).join('');
}

/** Trims, drops control characters, collapses spaces and caps the length (in code points). */
export function cleanName(raw) {
  return clampName(String(raw || '')
    .replace(BAD_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim())
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
 * The challenge link adarna.us/attention-test/s/SCORE (https), plus ?by=NAME when a name is given and
 * f=CODE when a valid friend code is given: /s/118?by=Maya&f=abcd2345, /s/118?f=abcd2345 or /s/118.
 */
export function shareUrl(score, name, friendCode) {
  const n = cleanName(name);
  const f = cleanFriendCode(friendCode);
  const params = [];
  if (n) {
    try {
      params.push(`by=${encodeURIComponent(n)}`);
    } catch (_) {
      /* a malformed name: share the link without it */
    }
  }
  if (f) params.push(`f=${f}`);
  return `${ORIGIN}/attention-test/s/${score}${params.length ? `?${params.join('&')}` : ''}`;
}

export function shareText(score) {
  return `I scored ${score} on the Clarus Attention Test (sharper than ${percentileOf(score)}% of people). Can you beat me? \u{1F9E0}`;
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
  return `Attention Test score card: ${d.score}, ${d.band}, sharper than ${d.pct}% of people. ${parts}.`;
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

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const scoredLine = (d) => (d.name ? `${d.name} scored` : 'I scored');

// ---------- the cards (24 Nov 2026): the site's dark tile design. A grain square in blue and green,
// white text beside it, the parts as divided rows and a blue "Can you beat me? ›".

const D = {
  bg: '#000000',
  ink: '#f5f5f7',
  grey: '#a1a1a6',
  faint: '#86868b',
  line: 'rgba(255, 255, 255, 0.16)',
  blue: '#2997ff',
};

function roundPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

let noise = null;
/** A 200 px tile of grey noise, made once, laid over the square for film grain. */
function noiseTile() {
  if (noise) return noise;
  noise = canvasOf(200, 200);
  const nctx = noise.getContext('2d');
  const img = nctx.createImageData(200, 200);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  return noise;
}

/** The blue-green grain square from the page, drawn still: a gradient, four soft lights and grain. */
function grainSquare(ctx, x, y, size, radius) {
  ctx.save();
  roundPath(ctx, x, y, size, size, radius);
  ctx.clip();
  const lg = ctx.createLinearGradient(x, y, x + size * 0.6, y + size);
  lg.addColorStop(0, '#1f5fe0');
  lg.addColorStop(0.45, '#1a4bb8');
  lg.addColorStop(1, '#11a37f');
  ctx.fillStyle = lg;
  ctx.fillRect(x, y, size, size);
  ctx.globalCompositeOperation = 'screen';
  const lights = [
    [0.28, 0.22, 0.6, '77, 134, 255', 0.9],
    [0.82, 0.86, 0.6, '35, 224, 168', 0.9],
    [0.86, 0.14, 0.42, '95, 208, 245', 0.7],
    [0.3, 0.92, 0.42, '154, 240, 210', 0.45],
  ];
  for (const [fx, fy, fr, rgb, a] of lights) {
    const cx = x + size * fx;
    const cy = y + size * fy;
    const r = size * fr;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(${rgb}, ${a})`);
    rg.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat');
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

/** Letter-spaced grey "CLARUS ATTENTION TEST" on the baseline y. */
function cardKicker(ctx, x, y, size, maxW) {
  fillText(ctx, 'CLARUS ATTENTION TEST', x, y, { weight: 600, size, maxW, color: D.faint, tracking: size * 0.16 });
}

/** The parts as divided rows from y, each rowH tall: label, detail (grey) and score on the right. */
function partRows(ctx, d, x0, x1, y, rowH, { label, detail, score }) {
  ctx.fillStyle = D.line;
  ctx.fillRect(x0, y, x1 - x0, 2);
  for (const p of d.parts) {
    const base = y + rowH / 2 + label * 0.36;
    fillText(ctx, p.label, x0, base, { weight: 500, size: label, maxW: (x1 - x0) * 0.4, color: D.ink });
    if (Number.isFinite(p.score)) {
      const sw = fillText(ctx, String(p.score), x1, y + rowH / 2 + score * 0.36, { weight: 600, size: score, maxW: score * 2.4, color: D.ink, align: 'right' });
      if (p.detail) fillText(ctx, p.detail, x1 - sw - score * 0.6, y + rowH / 2 + detail * 0.36, { weight: 400, size: detail, maxW: (x1 - x0) * 0.4, color: D.faint, align: 'right' });
    } else {
      fillText(ctx, p.hint, x1, y + rowH / 2 + detail * 0.36, { weight: 400, size: detail, maxW: (x1 - x0) * 0.5, color: D.faint, align: 'right' });
    }
    y += rowH;
    ctx.fillStyle = D.line;
    ctx.fillRect(x0, y - 2, x1 - x0, 2);
  }
  return y;
}

/** 1080x1920 card for Instagram / WhatsApp stories. Key content stays between y 250 and 1670 (story UI). */
export function drawStoryCard(d) {
  const W = 1080;
  const canvas = canvasOf(W, 1920);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = D.bg;
  ctx.fillRect(0, 0, W, 1920);
  const L = 96;
  const R = W - 96;

  // The tile: the square on the left, the score beside it, inside the square's height.
  const sq = 380;
  const top = 330;
  grainSquare(ctx, L, top, sq, 24);
  const tx = L + sq + 48;
  const tw = R - tx;
  cardKicker(ctx, tx, top + 30, 24, tw);
  fillText(ctx, scoredLine(d), tx, top + 104, { weight: 500, size: 48, maxW: tw, color: D.ink });
  fillText(ctx, String(d.score), tx - 8, top + 290, { weight: 600, size: 200, maxW: tw, color: D.ink });
  fillText(ctx, d.band, tx, top + sq - 6, { weight: 500, size: 44, maxW: tw, color: D.ink });

  fillText(ctx, `Sharper than ${d.pct}% of people`, L, top + sq + 110, { weight: 400, size: 40, maxW: R - L, color: D.grey });
  const end = partRows(ctx, d, L, R, top + sq + 170, 136, { label: 44, detail: 30, score: 64 });

  fillText(ctx, 'Can you beat me? ›', L, end + 150, { weight: 500, size: 60, maxW: R - L, color: D.blue });
  fillText(ctx, FOOTER_URL, L, 1590, { weight: 500, size: 38, maxW: R - L, color: D.ink });
  fillText(ctx, FOOTER_BRAND, L, 1640, { weight: 400, size: 30, maxW: R - L, color: D.faint });
  return canvas;
}

/** 1200x630 card for X, LinkedIn and Facebook posts: the square on the left, the score and parts on the right. */
export function drawPostCard(d) {
  const canvas = canvasOf(1200, 630);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = D.bg;
  ctx.fillRect(0, 0, 1200, 630);

  const sq = 470;
  const top = 56;
  grainSquare(ctx, 56, top, sq, 20);
  const x0 = 56 + sq + 48;
  const x1 = 1200 - 56;
  const cw = x1 - x0;
  cardKicker(ctx, x0, top + 20, 18, cw);
  fillText(ctx, scoredLine(d), x0, top + 66, { weight: 500, size: 28, maxW: cw, color: D.ink });
  fillText(ctx, String(d.score), x0 - 5, top + 190, { weight: 600, size: 130, maxW: cw, color: D.ink });
  fillText(ctx, `${d.band} · sharper than ${d.pct}% of people`, x0, top + 236, { weight: 400, size: 22, maxW: cw, color: D.grey });
  partRows(ctx, d, x0, x1, top + 262, 50, { label: 22, detail: 17, score: 26 });
  fillText(ctx, 'Can you beat me? ›', x0, top + sq - 4, { weight: 500, size: 26, maxW: cw * 0.55, color: D.blue });
  fillText(ctx, FOOTER_URL, x1, top + sq - 4, { weight: 400, size: 18, maxW: cw * 0.45, color: D.faint, align: 'right' });
  fillText(ctx, FOOTER_BRAND, 56, top + sq + 46, { weight: 400, size: 18, maxW: sq, color: D.faint });
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
  root.appendChild(h('h2', { class: 'ats-title', id: `${id}-title` }, 'Your score card'));
  root.appendChild(h('p', { class: 'ats-desc' }, 'Here’s a card you can share with friends. If you’d like your name on it, add it below. It’s completely optional.'));

  // name field
  const field = h('div', { class: 'ats-field' });
  field.appendChild(h('label', { class: 'ats-label', for: `${id}-name` }, 'Name on the card (optional)'));
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
      file = new File([sBlob], `clarus-attention-${score}.png`, { type: 'image/png' });
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
      downloadBlob(blob, `clarus-attention-${score}-${which}.png`);
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
