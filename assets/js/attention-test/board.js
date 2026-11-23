// Clarus Attention Test leaderboard (browser side).
//
//   const board = mountBoard(document.getElementById('at-board'));            // game page (compact, top 10)
//   const board = mountBoard(el, { variant: 'full' });                         // /attention-test/leaderboard (top 100)
//   board.offerJoin(run, scoreRun(run));                                       // after each valid run
//
// Playing and sharing never need an account; Google sign-in (Supabase Auth) is only for joining the board.
// The browser never sends a score: it sends the raw run, and the submit-score Edge Function re-scores it.
// While supabase-config.js is empty this renders a "Leaderboard opens soon" card and loads nothing.
// All text goes in with textContent / text nodes, never innerHTML (display names are user input).
//
// Friends (supabase/migrations/*_friends.sql): every profile has an 8-character friend_code. A signed-in
// player's challenge link carries it as ?f=<code>. This module
//   - writes the own code to localStorage[FRIEND_CODE_KEY] whenever a session and profile are loaded, and
//     removes it on sign-out and after "Remove my data" (share.js reads it to build links);
//   - saves an incoming ?f= to localStorage[INVITE_KEY] (kept 7 days) and, once signed in, calls
//     add_friend(code) so both people become friends.
//
// "Share my best score" (supabase/migrations/*_my_best.sql): the account panel offers it while the player has a
// valid play. A click fetches the raw best run with my_best(), re-scores it with scoreRun() and opens the share
// dialog (share-dialog.js) with the same story / post cards as a fresh result. When the stored run can't be
// re-scored (an old v1 run) or my_best() isn't there yet, it shares the challenge link (share.js) instead.
import { track } from './track.js';
import { checkRun, scoreRun } from './scoring.js?v=2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js?v=1'; // bump ?v= when the values change (/assets/js is cached for a year)

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
const PENDING_KEY = 'at-pending-run';
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
const SCOPE_KEY = 'at-board-scope'; // sessionStorage: reopen the Friends tab after the Google round trip
const FRIEND_CODE_KEY = 'clarus.attentionTest.friendCode';
const INVITE_KEY = 'clarus.attentionTest.invite';
const INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FRIEND_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const FULL_BOARD_PATH = '/attention-test/leaderboard';
const GAME_PATH = '/attention-test';
const PUBLIC_ORIGIN = 'https://adarna.us';
const INVITE_OK_KEY = 'at-invite-ok'; // sessionStorage: the invite code the visitor agreed to add before the Google round trip
const VARIANTS = { compact: 10, full: 100 }; // rows shown; the board() rpc caps at 100
const DAILY_LIMIT = 20;

const PERIODS = [
  ['today', 'Today', 'today'],
  ['week', 'This week', 'this week'],
  ['all', 'All time', 'all time'],
];
const DEVICES = [
  ['all', 'All'],
  ['phone', 'Phone'],
  ['computer', 'Computer'],
];
const DEVICE_LABEL = { phone: 'Phone', computer: 'Computer' };
// One score for everyone (23 Nov 2026): the game plays one level, so rows no longer show a level badge. Rows
// still carry a level from older runs; levelOf is kept only to read those safely.
const LEVEL_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const levelOf = (value) => (Object.prototype.hasOwnProperty.call(LEVEL_LABEL, value) ? value : null);
const SCOPES = [
  ['global', 'Global'],
  ['friends', 'Friends'],
];

// Keep in step with private.at_name_blocked in supabase/migrations/*_attention_test.sql (the server decides).
const BLOCK_ANYWHERE = ['fuck', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'asshole', 'motherf', 'dickhead',
  'retard', 'porn', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'bhosdi'];
const BLOCK_WORDS = ['shit', 'slut', 'bitch', 'bastard', 'pussy', 'rape', 'rapist', 'hitler', 'nazi', 'cock', 'penis',
  'vagina', 'boob', 'boobs', 'tits', 'twat', 'wank', 'wanker', 'kike', 'chink', 'paki', 'gandu', 'sex'];

const REJECTED = {
  tooFewAnswers: 'That run had too few reaction answers to score, so it wasn’t added.',
  tooManyFalseStarts: 'That run had too many early taps to score, so it wasn’t added.',
};

let mounts = 0;

const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const apiBase = () => String(SUPABASE_URL).replace(/\/+$/, '');
const fmt = (n) => Number(n).toLocaleString('en-US');
const prefersReducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tiny element builder. Strings become text nodes; booleans set properties (hidden, checked, disabled). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (typeof value === 'boolean') el[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

function googleIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const paths = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ];
  for (const [fill, d] of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('fill', fill);
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// ─── Display names ──────────────────────────────────────────────────────────────────────────────────────
const NAME_CHARS = /^[\p{L}\p{N}\p{M} ._-]+$/u;
const normalizeName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function isBlocked(name) {
  const s = name.toLowerCase().replace(/[013457]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' })[c]);
  const squashed = s.replace(/[ ._-]/g, '');
  if (BLOCK_ANYWHERE.some((w) => squashed.includes(w))) return true;
  return s.split(/[ ._-]+/).some((part) => BLOCK_WORDS.includes(part));
}

function nameProblem(name) {
  const length = [...name].length;
  if (length < 2 || length > 24) return 'Use 2 to 24 characters.';
  if (!NAME_CHARS.test(name) || !/[\p{L}\p{N}]/u.test(name)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
  if (isBlocked(name)) return 'Please pick a different name.';
  return null;
}

// ─── The run waiting for the Google round trip ──────────────────────────────────────────────────────────
function writePending(value) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch (_) {
    /* storage blocked */
  }
}

/** The saved run, if it is recent and still checks out; otherwise clears it and returns null. */
function readPending() {
  let value = null;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) value = JSON.parse(raw);
  } catch (_) {
    value = null;
  }
  if (!value) return null;
  try {
    const fresh = !value.savedAt || Date.now() - value.savedAt < PENDING_MAX_AGE_MS;
    if (fresh && value.run && checkRun(value.run) === null && scoreRun(value.run).valid) {
      return { run: value.run, launchEmails: value.launchEmails === true };
    }
  } catch (_) {
    /* fall through */
  }
  clearPending();
  return null;
}

// ─── Friend code and invite (localStorage; every access may throw in private modes) ─────────────────────
function storeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch (_) {
    return null;
  }
}

function storeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (_) {
    /* storage blocked */
  }
}

function storeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch (_) {
    /* storage blocked */
  }
}

const local = () => {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
};
const sess = () => {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
};

function writeOwnCode(code) {
  const ls = local();
  if (!ls) return;
  if (code && FRIEND_CODE_RE.test(code)) storeSet(ls, FRIEND_CODE_KEY, code);
  else storeRemove(ls, FRIEND_CODE_KEY);
}

// share.js signs challenge links with this name ("by="); fill it from the board name when the player
// hasn't typed one, so a friend's invite says "Add Maheswara as a friend" rather than "your friend".
const SHARE_NAME_KEY = 'clarus.attentionTest.shareName';
function fillShareName(name) {
  const ls = local();
  if (!ls || !name || storeGet(ls, SHARE_NAME_KEY)) return;
  storeSet(ls, SHARE_NAME_KEY, String(name).slice(0, 24));
}

function clearOwnCode() {
  const ls = local();
  if (ls) storeRemove(ls, FRIEND_CODE_KEY);
}

/** A display-safe "by" name from the URL or storage: trimmed, at most 24 characters, or ''. */
function cleanBy(value) {
  return [...normalizeName(value)].slice(0, 24).join('');
}

/** The stored invite { code, by, savedAt } if it is valid and under 7 days old; otherwise clears it. */
function readInvite() {
  const ls = local();
  if (!ls) return null;
  const raw = storeGet(ls, INVITE_KEY);
  if (!raw) return null;
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch (_) {
    value = null;
  }
  if (value && typeof value.code === 'string' && FRIEND_CODE_RE.test(value.code)
      && typeof value.savedAt === 'number' && Date.now() - value.savedAt < INVITE_MAX_AGE_MS) {
    return { code: value.code, by: cleanBy(value.by), savedAt: value.savedAt };
  }
  storeRemove(ls, INVITE_KEY);
  return null;
}

function clearInvite() {
  const ls = local();
  if (ls) storeRemove(ls, INVITE_KEY);
}

/** Saves ?f=<code> (and ?by=) from the address to storage, then drops f from the address bar. */
function captureInvite() {
  let url;
  try {
    url = new URL(location.href);
  } catch (_) {
    return;
  }
  const raw = url.searchParams.get('f');
  if (raw === null) return;
  const code = raw.trim().toLowerCase();
  if (FRIEND_CODE_RE.test(code)) {
    const ls = local();
    if (ls) storeSet(ls, INVITE_KEY, JSON.stringify({ code, by: cleanBy(url.searchParams.get('by')), savedAt: Date.now() }));
  }
  try {
    url.searchParams.delete('f');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch (_) {
    /* leave the URL alone */
  }
}

/** The link that makes the opener a friend: the live site, or this origin when testing locally. */
function friendLink(code) {
  const host = location.hostname;
  const local_ = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return `${local_ ? location.origin : PUBLIC_ORIGIN}${GAME_PATH}?f=${encodeURIComponent(code)}`;
}

/** Where Google sends the visitor back: this page if it is the game or the full board, else the game. */
function returnUrl() {
  const path = location.pathname.replace(/\/+$/, '');
  return `${location.origin}${path === GAME_PATH || path === FULL_BOARD_PATH ? path : GAME_PATH}`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

// ─── Auth parameters in the URL after the Google redirect ───────────────────────────────────────────────
function readOAuthError() {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return search.get('error_description') || search.get('error') || hash.get('error_description') || hash.get('error') || null;
}

function cleanAuthParams() {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const key of ['code', 'error', 'error_code', 'error_description']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (/(^|[#&])(access_token|error)=/.test(url.hash)) {
      url.hash = '';
      changed = true;
    }
    if (changed) history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch (_) {
    /* leave the URL alone */
  }
}

// ─── "Opens soon" (no Supabase project configured yet) ──────────────────────────────────────────────────
function renderSoon(el) {
  const id = `atb-soon-${++mounts}`;
  el.replaceChildren(
    h('section', { class: 'atb-card atb-soon', 'aria-labelledby': id },
      h('p', { class: 'atb-eyebrow', text: 'Leaderboard' }),
      h('h2', { class: 'atb-title', id, text: 'Leaderboard opens soon' }),
      h('p', { class: 'atb-sub', text: 'Daily and all-time boards are on the way. Your score is yours to keep and share, no account needed.' }),
    ),
  );
}

// ─── The live board ─────────────────────────────────────────────────────────────────────────────────────
function createBoard(el, variant) {
  const uid = `atb${++mounts}`;
  const top = VARIANTS[variant] || VARIANTS.compact;
  let sb = null;
  let session = null;
  let profile = null;
  let scope = 'global';
  // The small board on the game page shows this week (fuller than today); the full page starts on today.
  let period = variant === 'full' ? 'today' : 'week';
  let device = 'all';
  let loadSeq = 0;
  let flashNext = false;
  let retryPending = null;
  let inviteBusy = false;
  let best = null; // { score, level } of the caller's best valid play (all time), or null
  let bestSeq = 0;
  let bestBusy = false;

  // Notice slot: the join card, "Saving…", "You're #N today" or an error.
  const notice = h('div', { class: 'atb-notice', hidden: true });

  // The board's switches are small dropdowns on the right of its heading (owner, 23 Nov 2026):
  // whose scores (Global | Friends), the period (Today | This week | All time) and the device.
  function dropdown(label, options, value, onChange) {
    const select = h('select', { class: 'atb-scope-select', 'aria-label': label },
      options.map(([key, text]) => h('option', { value: key, text })));
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return { select, wrap: h('span', { class: 'atb-scope' }, select) };
  }
  const scopeDrop = dropdown('Whose scores', SCOPES, scope, (v) => setScope(v));
  const periodDrop = dropdown('Time period', PERIODS.map(([key, label]) => [key, label]), period, (v) => setPeriod(v));
  const deviceDrop = dropdown('Device', DEVICES.map(([key, label]) => [key, key === 'all' ? 'All devices' : label]), device, (v) => setDevice(v));
  const scopeSelect = scopeDrop.select;
  const scopeGroup = scopeDrop.wrap;
  const controls = h('span', { class: 'atb-controls' }, periodDrop.wrap, deviceDrop.wrap);

  const list = h('ol', { class: 'atb-list' });
  const empty = h('p', { class: 'atb-empty', hidden: true });
  const panelError = h('div', { class: 'atb-error', hidden: true },
    h('p', { text: 'Couldn’t load the leaderboard.' }),
    h('button', { type: 'button', class: 'atb-btn atb-btn-ghost', text: 'Try again', onclick: () => loadBoard() }),
  );
  // Friends scope messages (signed out, no friends yet, not available) replace the list.
  const friendsBox = h('div', { class: 'atb-friends-box', hidden: true });
  const panel = h('div', {
    class: 'atb-panel is-loading',
    id: `${uid}-panel`,
    'aria-label': 'Scores',
    'aria-busy': 'true',
    tabindex: '0',
  }, h('div', { class: 'atb-cols', 'aria-hidden': 'true' },
    h('span', { text: 'Rank' }), h('span', { text: 'Player' }), h('span', { text: 'Score' }),
  ), list, empty, panelError, friendsBox);

  // The caller's own row, pinned under the list (renderMe).
  const me = h('div', { class: 'atb-me', role: 'status', 'aria-label': 'Your rank', hidden: true });

  // "You and Priya are now friends on the board", "Sign in to add Priya as a friend".
  const friendNotice = h('p', { class: 'atb-friend-notice', role: 'status', hidden: true });
  const inviteRow = h('p', { class: 'atb-invite', hidden: true });

  // Under the friends list: invite more people.
  const friendsFoot = h('div', { class: 'atb-friends-foot', hidden: true }, copyControls('Invite more friends with your link.'));

  const moreRow = variant === 'full'
    ? null
    : h('p', { class: 'atb-more' }, h('a', { class: 'atb-btn atb-btn-ghost atb-more-btn', href: FULL_BOARD_PATH, text: 'See the full leaderboard ›' }));

  // Signed-out footer: a way back in to manage an existing entry.
  const signinRow = h('p', { class: 'atb-signin', hidden: true },
    'Already on the board? ',
    h('button', { type: 'button', class: 'atb-link', text: 'Sign in', onclick: () => startGoogle(null) }),
    ' to edit or hide your entry.',
  );

  // Signed-in account controls.
  const whoName = h('strong', { class: 'atb-who-name' });
  const editBtn = h('button', { type: 'button', class: 'atb-link', text: 'Edit name', onclick: () => openEdit() });
  const signOutBtn = h('button', { type: 'button', class: 'atb-link', text: 'Sign out', onclick: () => signOut() });
  const removeBtn = h('button', { type: 'button', class: 'atb-link atb-danger', text: 'Remove my data', onclick: () => removeData() });
  const showInput = h('input', {
    type: 'checkbox',
    role: 'switch',
    class: 'atb-switch-input',
    'aria-describedby': `${uid}-show-hint`,
    onchange: () => saveShow(),
  });
  const mailInput = h('input', { type: 'checkbox', onchange: () => saveMail() });
  const nameInput = h('input', {
    type: 'text',
    id: `${uid}-name`,
    class: 'atb-input',
    maxlength: '24',
    autocomplete: 'nickname',
    spellcheck: 'false',
    'aria-describedby': `${uid}-name-hint`,
  });
  const editMsg = h('p', { class: 'atb-form-msg', role: 'alert' });
  const editForm = h('form', { class: 'atb-edit', hidden: true, novalidate: '' },
    h('label', { class: 'atb-label', for: `${uid}-name`, text: 'Display name' }),
    h('div', { class: 'atb-edit-row' },
      nameInput,
      h('button', { type: 'submit', class: 'atb-btn atb-btn-primary', text: 'Save' }),
      h('button', { type: 'button', class: 'atb-btn atb-btn-ghost', text: 'Cancel', onclick: () => closeEdit() }),
    ),
    h('p', { class: 'atb-hint', id: `${uid}-name-hint`, text: '2 to 24 letters, numbers, spaces, dots, dashes or underscores.' }),
    editMsg,
  );
  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveName();
  });
  const accountMsg = h('p', { class: 'atb-form-msg', role: 'status' });
  // "Share my best score", shown once we know the player has a valid play.
  const bestLead = h('p', { class: 'atb-copy-lead' });
  const bestBtn = h('button', { type: 'button', class: 'atb-btn atb-btn-primary', text: 'Share my best score', onclick: () => shareBest() });
  const bestField = h('input', { type: 'text', class: 'atb-input atb-copy-field', readonly: '', 'aria-label': 'Your score link', hidden: true });
  const bestMsg = h('p', { class: 'atb-form-msg', role: 'status' });
  const bestBox = h('div', { class: 'atb-best-box', hidden: true }, h('div', { class: 'atb-copy' }, bestLead, bestBtn, bestField, bestMsg));
  const account = h('div', { class: 'atb-account', hidden: true },
    h('div', { class: 'atb-share-boxes' },
      bestBox,
      h('div', { class: 'atb-invite-box' }, copyControls('Invite friends: anyone who opens your link and joins shows up on your Friends board.')),
    ),
    h('p', { class: 'atb-who' }, 'Signed in as ', whoName),
    h('div', { class: 'atb-actions' }, editBtn, signOutBtn), // owner: no Remove my data button; deletion is by email (privacy policy)
    editForm,
    h('label', { class: 'atb-check atb-switch' }, showInput, h('span', { text: 'Show me on the global board' })),
    h('p', { class: 'atb-hint atb-switch-hint', id: `${uid}-show-hint`, text: 'Friends always see your best score.' }),
    h('label', { class: 'atb-check' }, mailInput, h('span', { text: 'Email me when Clarus Health launches' })),
    accountMsg,
  );

  const sub = h('p', { class: 'atb-sub' });
  const boardCard = h('section', { class: 'atb-card atb-board', 'aria-labelledby': `${uid}-title` },
    h('div', { class: 'atb-head' },
      // The full page has no hero card any more, so its board title is the page's h1.
      h(variant === 'full' ? 'h1' : 'h2', { class: 'atb-title', id: `${uid}-title`, text: 'Leaderboard' }),
      h('div', { class: 'atb-filters' }, scopeGroup, controls),
    ),
    friendNotice,
    inviteRow,
    panel,
    me,
    friendsFoot,
    moreRow,
    signinRow,
    account,
  );

  el.replaceChildren(notice, boardCard);
  updateSub();

  // ── Notice card helpers ──
  function showNotice(card) {
    notice.replaceChildren(card);
    notice.hidden = false;
  }

  function hideNotice() {
    notice.replaceChildren();
    notice.hidden = true;
  }

  function statusCard({ kind = 'info', eyebrow = null, title, text = null, actions = [] }) {
    return h('div', { class: `atb-card atb-status is-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      eyebrow ? h('p', { class: 'atb-eyebrow', text: eyebrow }) : null,
      h('h2', { class: 'atb-status-title', text: title }),
      text ? h('p', { class: 'atb-status-text', text }) : null,
      actions.length ? h('div', { class: 'atb-status-actions' }, actions) : null,
    );
  }

  function showFriendNotice(text) {
    friendNotice.textContent = text;
    friendNotice.hidden = !text;
  }

  function googleButton(msg, onBeforeLeave) {
    const button = h('button', { type: 'button', class: 'atb-google' }, googleIcon(), h('span', { text: 'Continue with Google' }));
    button.addEventListener('click', async () => {
      button.disabled = true;
      msg.textContent = 'Opening Google…';
      const ok = await onBeforeLeave();
      if (!ok) {
        button.disabled = false;
        msg.textContent = 'Couldn’t open Google sign-in. Please try again.';
      }
    });
    return button;
  }

  function showJoin(run, result, message = '') {
    // Ticked by default; the visitor can untick it before signing in.
    const mail = h('input', { type: 'checkbox', checked: true });
    const msg = h('p', { class: 'atb-form-msg', role: 'status', text: message });
    // Came from a friend's link: offer to add them in the same step. Ticking the box (shown, and on by
    // default) next to the button they press is the consent; the code is stored so only that invite is added.
    const invite = readInvite();
    const friendBox = invite ? h('input', { type: 'checkbox', checked: true }) : null;
    const button = googleButton(msg, () => {
      track('leaderboard_join_click');
      const ss = sess();
      if (ss && invite && friendBox && friendBox.checked) storeSet(ss, INVITE_OK_KEY, invite.code);
      else if (ss) storeRemove(ss, INVITE_OK_KEY);
      return startGoogle({ run, launchEmails: mail.checked });
    });
    showNotice(
      h('div', { class: 'atb-card atb-join' },
        h('div', { class: 'atb-join-score' },
          h('span', { class: 'atb-eyebrow', text: 'Your score' }),
          h('span', { class: 'atb-join-number', text: String(result.overall) }),
        ),
        h('div', { class: 'atb-join-body' },
          h('h2', { class: 'atb-status-title', text: 'Join the leaderboard' }),
          h('p', { class: 'atb-status-text', text: 'Would you like to see your rank? We only ever show a display name, like “Priya S.”' }),
          button,
          friendBox
            ? h('label', { class: 'atb-check' }, friendBox, h('span', { text: `Add ${invite.by || 'the friend who sent you the link'} as a friend` }))
            : null,
          h('label', { class: 'atb-check' }, mail, h('span', { text: 'Email me when Clarus launches' })),
          h('p', { class: 'atb-fine', text: 'Playing and sharing will always work without an account.' }),
          msg,
        ),
      ),
    );
  }

  /** Saves the run (if any) and leaves for Google. Resolves false if the redirect couldn't start. */
  async function startGoogle(pending, nextScope = null) {
    if (!sb) return false;
    if (pending) writePending({ run: pending.run, launchEmails: pending.launchEmails, savedAt: Date.now() });
    const ss = sess();
    if (ss) {
      if (nextScope) storeSet(ss, SCOPE_KEY, nextScope);
      else storeRemove(ss, SCOPE_KEY);
    }
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: returnUrl() },
      });
      if (error) throw error;
      return true;
    } catch (_) {
      track('leaderboard_error', { reason: 'oauth_start' });
      return false;
    }
  }

  // ── Submitting ──
  async function accessToken() {
    try {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.access_token : null;
    } catch (_) {
      return null;
    }
  }

  async function callFunction(name, body) {
    const token = await accessToken();
    if (!token) return { status: 401, body: {} };
    const res = await fetch(`${apiBase()}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body || {}),
    });
    let parsed = {};
    try {
      parsed = await res.json();
    } catch (_) {
      parsed = {};
    }
    return { status: res.status, body: parsed };
  }

  async function submit(pending) {
    clearPending();
    retryPending = pending;
    showNotice(statusCard({ kind: 'busy', title: 'Saving your score…' }));
    let reply;
    try {
      reply = await callFunction('submit-score', { run: pending.run, launchEmails: pending.launchEmails === true });
    } catch (_) {
      track('leaderboard_error', { reason: 'network' });
      showNotice(statusCard({
        kind: 'error',
        title: 'Couldn’t reach the leaderboard',
        text: 'Check your connection and try again. Your score is still here.',
        actions: [h('button', { type: 'button', class: 'atb-btn atb-btn-primary', text: 'Try again', onclick: () => retryPending && submit(retryPending) })],
      }));
      return;
    }
    const { status, body } = reply;
    if (status === 200) {
      retryPending = null;
      track('leaderboard_joined', { rank: body.rankToday || 0 });
      const bits = [`Score ${body.score}`];
      if (body.rankAll) bits.push(`#${fmt(body.rankAll)} all time`);
      showNotice(statusCard({
        kind: 'ok',
        eyebrow: 'You’re on the board',
        title: body.rankToday ? `You’re #${fmt(body.rankToday)} today` : 'Score saved',
        text: bits.join(' · '),
      }));
      setScope('global', false);
      setPeriod('today', false);
      setDevice('all', false);
      flashNext = true;
      await Promise.all([loadBoard(), refreshAccount()]);
      if (profile && !profile.show_on_board) {
        showNotice(statusCard({
          kind: 'ok',
          eyebrow: 'Score saved',
          title: body.rankToday ? `You’re #${fmt(body.rankToday)} today` : 'Score saved',
          text: `${bits.join(' · ')}. You’re hidden from the global board, so only you and your friends can see this.`,
        }));
      }
      scrollToBoard();
      return;
    }
    retryPending = null;
    if (status === 429) {
      track('leaderboard_error', { reason: 'rate_limit' });
      showNotice(statusCard({
        kind: 'error',
        title: 'That’s today’s limit',
        text: `Up to ${DAILY_LIMIT} runs a day go on the board. Come back tomorrow (the day resets at midnight UTC).`,
      }));
    } else if (status === 400 || status === 413) {
      const reason = (body && body.reason) || 'invalid';
      track('leaderboard_error', { reason: `invalid_${reason}` });
      showNotice(statusCard({
        kind: 'error',
        title: 'This run can’t go on the board',
        text: REJECTED[reason] || 'We couldn’t verify this run, so it wasn’t added. Play again and the next one can count.',
      }));
    } else if (status === 401) {
      track('leaderboard_error', { reason: 'auth' });
      showJoin(pending.run, scoreRun(pending.run), 'Your sign-in expired. Please continue with Google again.');
    } else {
      track('leaderboard_error', { reason: `server_${status}` });
      retryPending = pending;
      showNotice(statusCard({
        kind: 'error',
        title: 'Something went wrong on our side',
        text: 'Your score wasn’t saved. Please try again in a moment.',
        actions: [h('button', { type: 'button', class: 'atb-btn atb-btn-primary', text: 'Try again', onclick: () => retryPending && submit(retryPending) })],
      }));
    }
    loadBoard();
  }

  function scrollToBoard() {
    try {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    } catch (_) {
      /* old browsers */
    }
  }

  // ── Scope, tabs and filter ──
  function updateSub() {
    if (variant !== 'full') {
      sub.textContent = scope === 'friends' ? `You and your friends, top ${top} this week.` : `Top ${top} this week.`;
      return;
    }
    sub.textContent = scope === 'friends'
      ? 'You and your friends, each person’s best score. Days are UTC; this week is the last 7 days.'
      : `Each person’s best score, top ${top}. Days are UTC; this week is the last 7 days.`;
  }

  function setScope(key, reload = true) {
    scope = key === 'friends' ? 'friends' : 'global';
    scopeSelect.value = scope;
    updateSub();
    updateChrome();
    if (reload) loadBoard();
  }

  function setPeriod(key, reload = true) {
    period = key;
    periodDrop.select.value = key;
    if (reload) loadBoard();
  }

  function setDevice(key, reload = true) {
    device = key;
    deviceDrop.select.value = key;
    if (reload) loadBoard();
  }

  /**
   * The invite lines. Signed out: "Sign in to add Priya as a friend" (that click is the consent).
   * Signed in: "Add Priya as a friend?" with Add friend / Not now, so a link alone never adds anyone.
   */
  function updateChrome() {
    signinRow.hidden = Boolean(session) || scope === 'friends' || !sb;
    const invite = sb ? readInvite() : null;
    const who = invite ? invite.by || 'your friend' : '';
    if (invite && !session) {
      inviteRow.replaceChildren(
        h('button', {
          type: 'button',
          class: 'atb-link',
          text: 'Sign in',
          onclick: () => {
            // Remember which code they agreed to, so only that invite is added without a second click.
            const ss = sess();
            if (ss) storeSet(ss, INVITE_OK_KEY, invite.code); // storage blocked: they'll confirm after
            startGoogle(null, 'friends');
          },
        }),
        ` to add ${who} as a friend.`,
      );
      inviteRow.hidden = false;
    } else if (invite && session && profile && invite.code !== ownCode() && !inviteBusy) {
      inviteRow.replaceChildren(
        `Add ${who} as a friend? `,
        h('button', { type: 'button', class: 'atb-link', text: 'Add friend', onclick: () => acceptInvite() }),
        ' · ',
        h('button', {
          type: 'button',
          class: 'atb-link',
          text: 'Not now',
          onclick: () => {
            clearInvite();
            clearInviteConsent();
            track('friend_invite_dismissed');
            updateChrome();
          },
        }),
      );
      inviteRow.hidden = false;
    } else {
      inviteRow.replaceChildren();
      inviteRow.hidden = true;
    }
  }

  // ── Board ──
  function periodWord(key) {
    return (PERIODS.find((p) => p[0] === key) || PERIODS[0])[2];
  }

  /** Rank cell: a plain number for every row, 1 to 3 included (owner: no special design for the top 3). */
  function rankCell(rank) {
    const n = Number(rank);
    return h('span', { class: 'atb-rank', text: Number.isFinite(n) && n > 0 ? fmt(n) : '–' });
  }

  /**
   * The caller's own row, pinned under the list like a standard leaderboard: rank, name with a
   * "You" chip and a short line under it, and the score. rank / score are null when there is none yet.
   */
  function renderMe({ rank = null, name = '', line = '', score = null }) {
    me.replaceChildren(
      h('div', { class: 'atb-row atb-me-row is-me' },
        rankCell(rank),
        h('span', { class: 'atb-name' },
          h('span', { class: 'atb-name-line' },
            h('span', { class: 'atb-name-text', text: name || 'You' }),
            name ? h('span', { class: 'atb-you', text: 'You' }) : null,
          ),
          line ? h('span', { class: 'atb-me-line', text: line }) : null,
        ),
        h('span', { class: 'atb-score', text: score === null || score === undefined ? '–' : String(score) }),
      ),
    );
    me.hidden = false;
  }

  /** The pinned row for someone who isn't signed in: no rank yet, and how to get one. */
  function renderMeSignedOut() {
    renderMe({ line: 'Play and join to get your rank.' });
  }

  const myName = () => (profile && profile.display_name) || '';

  function row(entry) {
    const isMe = entry.is_me === true;
    const when = entry.achieved_at ? new Date(entry.achieved_at) : null;
    const li = h('li', { class: `atb-row${isMe ? ' is-me' : ''}${isMe && flashNext ? ' is-new' : ''}` },
      rankCell(entry.rank),
      h('span', { class: 'atb-name' },
        h('span', { class: 'atb-name-line' },
          h('span', { class: 'atb-name-text', text: entry.display_name }),
          isMe ? h('span', { class: 'atb-you', text: 'You' }) : null,
        ),
      ),
      h('span', { class: 'atb-dev', text: DEVICE_LABEL[entry.device] || '' }),
      h('span', { class: 'atb-score', text: String(entry.score) }),
    );
    // Owner: friends can't remove each other, so friend rows have no Remove control (and no friend codes).
    if (when && !Number.isNaN(when.getTime())) li.title = when.toLocaleString();
    if (isMe) li.setAttribute('aria-current', 'true');
    return li;
  }

  function setLoading(on) {
    panel.classList.toggle('is-loading', on);
    panel.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  /** List mode: the ranked list (or its empty / error line) with the period and device controls. */
  function showListMode() {
    friendsBox.replaceChildren();
    friendsBox.hidden = true;
    controls.hidden = false;
  }

  /** A friends-scope message in place of the list; the period and device controls are hidden. */
  function showFriendsBox(content) {
    setLoading(false);
    list.replaceChildren();
    empty.hidden = true;
    panelError.hidden = true;
    me.hidden = true;
    friendsFoot.hidden = true;
    controls.hidden = true;
    friendsBox.replaceChildren(content);
    friendsBox.hidden = false;
  }

  async function loadBoard() {
    if (!sb) return;
    const seq = ++loadSeq;
    const p = period;
    const d = device;
    if (scope === 'friends') {
      if (!session) {
        showFriendsBox(signedOutFriendsCard());
        return;
      }
      setLoading(true);
      await loadFriends(seq, p, d);
      return;
    }
    friendsFoot.hidden = true;
    showListMode();
    setLoading(true);
    let boardRes;
    let meRes = { data: null, error: null };
    try {
      [boardRes, meRes] = await Promise.all([
        sb.rpc('board', { period: p, device: d, max_rows: top }),
        session ? sb.rpc('my_rank', { period: p, device: d }) : Promise.resolve({ data: null, error: null }),
      ]);
    } catch (err) {
      boardRes = { data: null, error: err };
    }
    if (seq !== loadSeq) return;
    setLoading(false);

    if (boardRes.error || !Array.isArray(boardRes.data)) {
      list.replaceChildren();
      empty.hidden = true;
      panelError.hidden = false;
      me.hidden = true;
      track('leaderboard_error', { reason: 'board_load' });
      return;
    }
    panelError.hidden = true;
    const rows = boardRes.data;
    list.replaceChildren(...rows.map((r) => row(r)));
    flashNext = false;
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = p === 'all' ? 'No scores yet. Be the first.' : `No scores ${periodWord(p)} yet. Be the first.`;
    }

    if (!session) {
      renderMeSignedOut();
      return;
    }
    const mine = !meRes.error && Array.isArray(meRes.data) ? meRes.data[0] : null;
    if (mine) {
      let line = `#${fmt(mine.rank)} of ${fmt(mine.total)} ${periodWord(p)}`;
      if (mine.hidden) line += ' · hidden from the global board';
      renderMe({ rank: mine.rank, name: myName(), line, score: mine.score });
    } else {
      renderMe({ name: myName(), line: `No score from you ${periodWord(p)} yet.` });
    }
  }

  async function loadFriends(seq, p, d) {
    const userId = session.user.id;
    let boardRes;
    let countRes;
    try {
      [boardRes, countRes] = await Promise.all([
        sb.rpc('friends_board', { period: p, device: d }),
        sb.from('friendships').select('friend_id', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
    } catch (err) {
      boardRes = { data: null, error: err };
      countRes = { count: null, error: err };
    }
    if (seq !== loadSeq || scope !== 'friends') return;
    setLoading(false);

    if (boardRes.error || !Array.isArray(boardRes.data)) {
      showFriendsBox(unavailableCard());
      track('leaderboard_error', { reason: 'friends_load' });
      return;
    }
    const rows = boardRes.data;
    const friendCount = countRes && !countRes.error && typeof countRes.count === 'number'
      ? countRes.count
      : rows.filter((r) => r.is_me !== true).length;
    if (friendCount === 0) {
      showFriendsBox(noFriendsCard());
      return;
    }

    showListMode();
    panelError.hidden = true;
    list.replaceChildren(...rows.slice(0, top).map((r) => row(r)));
    flashNext = false;
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = p === 'all'
        ? 'No scores from you or your friends yet.'
        : `No scores from you or your friends ${periodWord(p)} yet.`;
    }
    const mine = rows.find((r) => r.is_me === true);
    if (mine) {
      renderMe({ rank: mine.rank, name: mine.display_name || myName(), line: `#${fmt(mine.rank)} of ${fmt(rows.length)} among friends ${periodWord(p)}`, score: mine.score });
    } else {
      renderMe({ name: myName(), line: `No score from you ${periodWord(p)} yet.` });
    }
    friendsFoot.hidden = false;
  }

  // ── Friends ──
  function clearInviteConsent() {
    const ss = sess();
    if (ss) storeRemove(ss, INVITE_OK_KEY);
  }

  function ownCode() {
    return profile && typeof profile.friend_code === 'string' && FRIEND_CODE_RE.test(profile.friend_code)
      ? profile.friend_code
      : null;
  }

  /**
   * "Share friend link": opens the phone's share sheet where there is one, otherwise copies the link.
   * Falls back to a selectable field when copying is blocked.
   */
  function copyControls(lead) {
    const msg = h('p', { class: 'atb-form-msg', role: 'status' });
    const field = h('input', {
      type: 'text',
      class: 'atb-input atb-copy-field',
      readonly: '',
      'aria-label': 'Your friend link',
      hidden: true,
    });
    const canShare = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const button = h('button', { type: 'button', class: 'atb-btn atb-btn-primary', text: canShare ? 'Share friend link' : 'Copy friend link' });
    button.addEventListener('click', async () => {
      const code = ownCode();
      if (!code) {
        msg.textContent = 'Your friend link isn’t ready yet. Please try again in a moment.';
        return;
      }
      const link = friendLink(code);
      if (canShare) {
        try {
          await navigator.share({
            title: 'Clarus Attention Test',
            text: 'How sharp is your attention? Take the 2-minute test and join my friends board.',
            url: link,
          });
          track('friend_link_share');
          msg.textContent = '';
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // closed the share sheet
          // Anything else: fall through to copying.
        }
      }
      const ok = await copyText(link);
      track('friend_link_copy');
      if (ok) {
        field.hidden = true;
        msg.textContent = 'Link copied. Send it to a friend.';
      } else {
        field.value = link;
        field.hidden = false;
        field.focus();
        field.select();
        msg.textContent = 'Copy this link and send it to a friend.';
      }
    });
    return h('div', { class: 'atb-copy' },
      lead ? h('p', { class: 'atb-copy-lead', text: lead }) : null,
      button,
      field,
      msg,
    );
  }

  function signedOutFriendsCard() {
    const msg = h('p', { class: 'atb-form-msg', role: 'status' });
    return h('div', { class: 'atb-friends-card' },
      h('h3', { class: 'atb-friends-title', text: 'See how you rank against friends' }),
      h('p', { class: 'atb-status-text', text: 'Sign in with Google, then send your challenge link. Anyone who opens it and joins shows up here.' }),
      googleButton(msg, () => {
        track('friends_signin_click');
        return startGoogle(null, 'friends');
      }),
      msg,
    );
  }

  function noFriendsCard() {
    return h('div', { class: 'atb-friends-card' },
      h('h3', { class: 'atb-friends-title', text: 'No friends yet' }),
      h('p', { class: 'atb-status-text', text: 'Send your challenge link: anyone who opens it and joins shows up here.' }),
      copyControls(null),
    );
  }

  function unavailableCard() {
    return h('div', { class: 'atb-friends-card' },
      h('h3', { class: 'atb-friends-title', text: 'Friends board isn’t available yet' }),
      h('p', { class: 'atb-status-text', text: 'The global board works as usual. Please check back soon.' }),
      h('button', { type: 'button', class: 'atb-btn atb-btn-ghost', text: 'Try again', onclick: () => loadBoard() }),
    );
  }


  /** With a session and a stored invite that isn't our own code: become friends, then open the Friends tab. */
  async function acceptInvite() {
    if (inviteBusy || !sb || !session) return;
    const invite = readInvite();
    if (!invite) return;
    if (invite.code === ownCode()) {
      clearInvite();
      updateChrome();
      return;
    }
    inviteBusy = true;
    let res;
    try {
      res = await sb.rpc('add_friend', { code: invite.code });
    } catch (err) {
      res = { data: null, error: err };
    }
    inviteBusy = false;
    if (!session) return;
    if (res.error) {
      const text = `${res.error.message || ''} ${res.error.hint || ''}`;
      if (/own_code|bad_code/.test(text)) {
        clearInvite();
      } else if (/friend_limit/.test(text)) {
        clearInvite();
        showFriendNotice('Your friends board is full (500 people), so this friend wasn’t added.');
      } else {
        // Network trouble or the friends feature isn't live yet: keep the invite (up to 7 days) for later.
        track('leaderboard_error', { reason: 'add_friend' });
      }
      updateChrome();
      return;
    }
    clearInvite();
    updateChrome();
    if (typeof res.data === 'string' && res.data) {
      track('friend_added');
      showFriendNotice(`You and ${res.data} are now friends on the board`);
      setScope('friends');
    } else {
      showFriendNotice('That friend link isn’t valid any more.');
    }
  }

  // ── Share my best score ──
  /** The caller's best play from my_best(): the row, null when there's none, undefined when the call failed. */
  async function fetchMyBest() {
    try {
      const res = await sb.rpc('my_best');
      if (res.error) return undefined;
      const r = Array.isArray(res.data) ? res.data[0] : res.data;
      return r && r.overall !== null && Number.isFinite(Number(r.overall)) ? r : null;
    } catch (_) {
      return undefined;
    }
  }

  /** Shows "Share my best score" when the player has a valid play (my_best, or my_rank all time before that migration). */
  async function refreshBest() {
    const seq = ++bestSeq;
    if (!sb || !session) {
      showBest(null);
      return;
    }
    const userId = session.user.id;
    let next = null;
    const row = await fetchMyBest();
    if (row) {
      next = { score: Number(row.overall), level: levelOf(row.level) };
    } else if (row === undefined) {
      try {
        const res = await sb.rpc('my_rank', { period: 'all', device: 'all' });
        const r = !res.error && Array.isArray(res.data) ? res.data[0] : null;
        if (r && Number.isFinite(Number(r.score))) next = { score: Number(r.score), level: levelOf(r.level) };
      } catch (_) {
        /* no button when we can't tell */
      }
    }
    if (seq !== bestSeq || !session || session.user.id !== userId) return;
    showBest(next);
  }

  function showBest(next) {
    best = next;
    bestBox.hidden = !best;
    if (!best) {
      bestMsg.textContent = '';
      bestField.hidden = true;
      return;
    }
    bestLead.textContent = `Your best score is ${best.score}. Share it with friends.`;
  }

  /** The challenge link for the best score: the share sheet on phones, otherwise copied. */
  async function shareBestLink(score, level) {
    const mod = await import('./share.js?v=8');
    const url = mod.shareUrl(score, profile ? profile.display_name : '', mod.loadFriendCode() || ownCode() || '', level);
    const text = mod.shareText(score, level);
    const canShare = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (canShare) {
      try {
        await navigator.share({ title: 'Clarus Attention Test', text, url });
        track('share', { channel: 'best', method: 'native', kind: 'link' });
        bestMsg.textContent = '';
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // closed the share sheet
      }
    }
    if (await copyText(`${text} ${url}`)) {
      track('share', { channel: 'best', method: 'copy', kind: 'link' });
      bestField.hidden = true;
      bestMsg.textContent = 'Link to your best score copied. Paste it anywhere to challenge friends.';
    } else {
      bestField.value = url;
      bestField.hidden = false;
      bestField.focus();
      bestField.select();
      bestMsg.textContent = 'Copy this link to share your best score.';
    }
  }

  async function shareBest() {
    if (!session || bestBusy) return;
    bestBusy = true;
    bestBtn.setAttribute('aria-busy', 'true'); // not disabled: it keeps focus, so the dialog can hand it back
    bestMsg.textContent = '';
    bestField.hidden = true;
    try {
      const row = await fetchMyBest();
      if (row === null) {
        showBest(null); // no valid play any more
        return;
      }
      // Only v2 runs re-score (checkRun's 'badVersion' test); older runs get a score-only card.
      if (row && row.raw && typeof row.raw === 'object' && checkRun(row.raw) !== 'badVersion') {
        let result = null;
        try {
          result = scoreRun(row.raw);
        } catch (_) {
          result = null;
        }
        if (result && result.valid && Number.isFinite(result.overall)) {
          showBest({ score: result.overall, level: levelOf(result.level) || levelOf(row.level) });
          const { openShareDialog } = await import('./share-dialog.js?v=5');
          track('share_open', { channel: 'best', kind: 'card' });
          bestBusy = false;
          bestBtn.removeAttribute('aria-busy');
          await openShareDialog({ result, run: row.raw, title: 'Share your best score' });
          return;
        }
      }
      // An old (v1) run that scoring.js can't re-score, or my_best() not deployed yet: a score-only card.
      const score = row ? Number(row.overall) : best && best.score;
      const level = levelOf(row ? row.level : best && best.level) || 'normal';
      if (!Number.isFinite(score)) {
        bestMsg.textContent = 'Couldn’t load your best score. Please try again.';
        return;
      }
      // Score-only card: old runs can't be re-drawn part by part, so the card shows the score and level.
      try {
        const { openShareDialog } = await import('./share-dialog.js?v=5');
        track('share_open', { channel: 'best', kind: 'card_score_only' });
        bestBusy = false;
        bestBtn.removeAttribute('aria-busy');
        await openShareDialog({
          result: { valid: true, overall: score, level, bonus: 0, scoreOnly: true },
          run: { level },
          title: 'Share your best score',
        });
      } catch (_) {
        await shareBestLink(score, level);
      }
    } catch (_) {
      bestMsg.textContent = 'Couldn’t share your best score. Please try again.';
      track('leaderboard_error', { reason: 'share_best' });
    } finally {
      bestBusy = false;
      bestBtn.removeAttribute('aria-busy');
    }
  }

  // ── Account ──
  async function loadProfile(userId) {
    // friend_code arrives with the friends migration; until then fall back to the original columns.
    for (const cols of ['display_name, show_on_board, launch_emails, friend_code', 'display_name, show_on_board, launch_emails']) {
      try {
        const res = await sb.from('profiles').select(cols).eq('user_id', userId).maybeSingle();
        if (!res.error) return res.data;
      } catch (_) {
        /* try the next column list */
      }
    }
    return null;
  }

  async function refreshAccount() {
    if (!session) {
      profile = null;
      clearInviteConsent();
      clearOwnCode();
      account.hidden = true;
      refreshBest();
      updateChrome();
      closeEdit();
      return;
    }
    account.hidden = false;
    updateChrome();
    accountMsg.textContent = '';
    const userId = session.user.id;
    const data = await loadProfile(userId);
    if (!session || session.user.id !== userId) return;
    profile = data;
    if (profile) {
      writeOwnCode(profile.friend_code);
      fillShareName(profile.display_name);
    }
    whoName.textContent = profile ? profile.display_name : 'your Google account';
    showInput.checked = profile ? profile.show_on_board : true;
    mailInput.checked = profile ? profile.launch_emails : false;
    for (const input of [showInput, mailInput]) input.disabled = !profile;
    editBtn.disabled = !profile;
    refreshBest();
    // Add the friend straight away only when they signed in from "Sign in to add Priya as a friend", and only
    // the invite they agreed to then (the stored code must match the current invite).
    const ss = sess();
    const agreed = ss ? storeGet(ss, INVITE_OK_KEY) : null;
    clearInviteConsent();
    const invite = readInvite();
    const consented = Boolean(agreed && invite && agreed === invite.code);
    if (consented) acceptInvite();
    else updateChrome();
  }

  async function updateProfile(fields) {
    if (!session || !profile) return { error: { message: 'no profile' } };
    try {
      return await sb.from('profiles').update(fields).eq('user_id', session.user.id);
    } catch (err) {
      return { error: err };
    }
  }

  function openEdit() {
    if (!profile) return;
    nameInput.value = profile.display_name;
    editMsg.textContent = '';
    editForm.hidden = false;
    editBtn.setAttribute('aria-expanded', 'true');
    nameInput.focus();
    nameInput.select();
  }

  function closeEdit() {
    editForm.hidden = true;
    editMsg.textContent = '';
    editBtn.setAttribute('aria-expanded', 'false');
  }

  async function saveName() {
    const name = normalizeName(nameInput.value);
    const problem = nameProblem(name);
    if (problem) {
      editMsg.textContent = problem;
      return;
    }
    if (profile && name === profile.display_name) {
      closeEdit();
      return;
    }
    editMsg.textContent = 'Saving…';
    const { error } = await updateProfile({ display_name: name });
    if (error) {
      const text = String(error.message || '');
      editMsg.textContent = text.includes('name_not_allowed')
        ? 'Please pick a different name.'
        : error.code === '23514'
          ? 'That name has characters we can’t show. Try plain letters and numbers.'
          : 'Couldn’t save your name. Please try again.';
      track('leaderboard_error', { reason: 'name_save' });
      return;
    }
    profile.display_name = name;
    whoName.textContent = name;
    closeEdit();
    editBtn.focus();
    accountMsg.textContent = 'Name saved.';
    loadBoard();
  }

  async function saveShow() {
    const want = showInput.checked;
    showInput.disabled = true;
    const { error } = await updateProfile({ show_on_board: want });
    showInput.disabled = false;
    if (error) {
      showInput.checked = !want;
      accountMsg.textContent = 'Couldn’t save that. Please try again.';
      track('leaderboard_error', { reason: 'show_save' });
      return;
    }
    profile.show_on_board = want;
    accountMsg.textContent = want
      ? 'You’re shown on the global board.'
      : 'You’re hidden from the global board. Friends still see your best score, and your scores are kept.';
    loadBoard();
  }

  async function saveMail() {
    const want = mailInput.checked;
    mailInput.disabled = true;
    const { error } = await updateProfile({ launch_emails: want });
    mailInput.disabled = false;
    if (error) {
      mailInput.checked = !want;
      accountMsg.textContent = 'Couldn’t save that. Please try again.';
      track('leaderboard_error', { reason: 'mail_save' });
      return;
    }
    profile.launch_emails = want;
    accountMsg.textContent = want ? 'We’ll email you when Clarus Health launches.' : 'No launch email will be sent.';
  }

  async function signOut() {
    try {
      await sb.auth.signOut();
    } catch (_) {
      /* the local session is cleared either way */
    }
    session = null;
    clearOwnCode();
    hideNotice();
    showFriendNotice('');
    await refreshAccount();
    loadBoard();
  }

  async function removeData() {
    const sure = window.confirm(
      'Remove your leaderboard name, all your scores and your sign-in? This can’t be undone.',
    );
    if (!sure) return;
    removeBtn.disabled = true;
    accountMsg.textContent = 'Removing…';
    let ok = false;
    try {
      const reply = await callFunction('delete-me', {});
      ok = reply.status === 200;
    } catch (_) {
      ok = false;
    }
    removeBtn.disabled = false;
    if (!ok) {
      accountMsg.textContent = 'Couldn’t remove your data. Please try again.';
      track('leaderboard_error', { reason: 'delete' });
      return;
    }
    try {
      await sb.auth.signOut({ scope: 'local' });
    } catch (_) {
      /* the user is gone already */
    }
    session = null;
    clearPending();
    clearOwnCode();
    showFriendNotice('');
    await refreshAccount();
    showNotice(statusCard({ kind: 'info', title: 'Your data has been removed', text: 'Your name, scores and sign-in are deleted. You can still play any time.' }));
    loadBoard();
  }

  // ── Start ──
  async function init() {
    const oauthError = readOAuthError();
    const ss = sess();
    if (ss && storeGet(ss, SCOPE_KEY) === 'friends') setScope('friends', false);
    if (ss) storeRemove(ss, SCOPE_KEY);
    try {
      const mod = await import(SUPABASE_JS);
      sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (_) {
      sb = null;
      setLoading(false);
      scopeGroup.hidden = true;
      panelError.hidden = false;
      panelError.querySelector('button').hidden = true;
      track('leaderboard_error', { reason: 'sdk_load' });
      return;
    }
    try {
      const { data } = await sb.auth.getSession();
      session = data.session || null;
    } catch (_) {
      session = null;
    }
    cleanAuthParams();

    sb.auth.onAuthStateChange((_event, next) => {
      const before = session ? session.user.id : null;
      const after = next ? next.user.id : null;
      session = next || null;
      // Don't call Supabase inside this callback (supabase-js can deadlock); do it on the next tick.
      if (before !== after) setTimeout(() => {
        refreshAccount();
        loadBoard();
      }, 0);
    });

    const pending = readPending();
    if (pending && session) {
      refreshAccount();
      await submit(pending);
    } else {
      if (pending) {
        clearPending();
        showJoin(pending.run, scoreRun(pending.run), oauthError ? 'Sign-in didn’t finish. You can try again.' : '');
      }
      refreshAccount();
      await loadBoard();
    }
    track('leaderboard_view', { variant });
  }

  const ready = init();

  return {
    async offerJoin(run, result) {
      if (!result || !result.valid || result.overall === null || result.overall === undefined) return;
      await ready;
      if (!sb) return;
      if (session) await submit({ run, launchEmails: false });
      else showJoin(run, result);
    },
  };
}

/**
 * Renders the leaderboard into `el` and returns `{ offerJoin(run, result) }`.
 * offerJoin shows "Join the leaderboard" (or, when already signed in, submits straight away).
 * opts.variant: 'compact' (default; top 10 and a link to the full board) or 'full' (top 100).
 */
export function mountBoard(el, opts = {}) {
  captureInvite();
  if (!el) return { offerJoin() {} };
  el.classList.add('atb');
  if (!configured()) {
    renderSoon(el);
    return { offerJoin() {} };
  }
  const variant = opts && opts.variant === 'full' ? 'full' : 'compact';
  el.classList.add(`atb-${variant}`);
  const board = createBoard(el, variant);
  return {
    offerJoin(run, result) {
      board.offerJoin(run, result).catch(() => track('leaderboard_error', { reason: 'offer_join' }));
    },
  };
}
