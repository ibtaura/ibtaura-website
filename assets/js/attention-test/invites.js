// Friend links for the Attention Test: the pure list logic behind localStorage[INVITES_KEY]. Nothing here touches
// storage, the page or the network (board.js does that), so the Node tests can import it.
//
//   localStorage['clarus.attentionTest.invites'] = JSON [{"code": "abcd2345", "by": "Priya", "savedAt": <ms>}, ...]
//
// Newest first, one entry per friend code, at most INVITE_MAX entries, each kept INVITE_MAX_AGE_MS (30 days) from
// the moment the link was opened. "declined": true marks a link the visitor opted out of (unticked "Add Priya as a
// friend", or "Not now" on the signed-in invite line); it is never added automatically and expires like the rest.
//
// Opening a friend's link (?f=<code>&by=<name>) is the consent: on the next sign-in board.js calls
// add_friend(code) for every live invite, one after another, and removes each one once it is done. Opening the
// same link again refreshes its date and name and clears an earlier "declined".
//
// Until 24 Nov 2026 a single object {code, by, savedAt} lived under LEGACY_INVITE_KEY. parseStoredInvites reads that
// shape too, and board.js moves it into the list and deletes the old key.

export const INVITES_KEY = 'clarus.attentionTest.invites';
export const LEGACY_INVITE_KEY = 'clarus.attentionTest.invite';
export const INVITE_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_MAX_AGE_MS = 30 * DAY_MS;
/** A savedAt further in the future than this (a wrong clock or an edited entry) is not trusted. */
const FUTURE_SLACK_MS = DAY_MS;
export const FRIEND_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;

const plainBy = (value) => (typeof value === 'string' ? value : '');

const fresh = (savedAt, now) => now - savedAt < INVITE_MAX_AGE_MS && savedAt - now <= FUTURE_SLACK_MS;

/** A clean { code, by, savedAt[, declined] } or null when the value is malformed or expired. */
function cleanEntry(value, now, cleanBy) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { code, savedAt } = value;
  if (typeof code !== 'string' || !FRIEND_CODE_RE.test(code)) return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || !fresh(savedAt, now)) return null;
  const entry = { code, by: cleanBy(value.by) || '', savedAt };
  if (value.declined === true) entry.declined = true;
  return entry;
}

/** Newest first, the newest entry per code only, at most INVITE_MAX. */
function tidy(list) {
  const seen = new Set();
  return [...list]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((entry) => {
      if (seen.has(entry.code)) return false;
      seen.add(entry.code);
      return true;
    })
    .slice(0, INVITE_MAX);
}

/**
 * The invite list from stored JSON. `raw` is one stored string or an array of them (the list key and the old
 * single-invite key); each may be null, a JSON array of invites or the old single object. Corrupt JSON, bad codes
 * and expired entries are dropped. `cleanBy` tidies the friend's name (board.js passes its name cleaner).
 */
export function parseStoredInvites(raw, now, cleanBy = plainBy) {
  const out = [];
  for (const text of Array.isArray(raw) ? raw : [raw]) {
    if (typeof text !== 'string' || !text) continue;
    let value;
    try {
      value = JSON.parse(text);
    } catch (_) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      const entry = cleanEntry(item, now, cleanBy);
      if (entry) out.push(entry);
    }
  }
  return tidy(out);
}

/** Adds a just-opened link { code, by } at the top; an existing entry for that code is refreshed (not declined). */
export function mergeInvite(list, invite, now) {
  const kept = (Array.isArray(list) ? list : []).filter((entry) => fresh(entry.savedAt, now));
  if (!invite || typeof invite.code !== 'string' || !FRIEND_CODE_RE.test(invite.code)) return tidy(kept);
  const before = kept.find((entry) => entry.code === invite.code);
  const by = plainBy(invite.by) || (before ? before.by : '');
  return tidy([{ code: invite.code, by, savedAt: now }, ...kept.filter((entry) => entry.code !== invite.code)]);
}

/** The invites to add on sign-in: not declined, not expired, and not the player's own code. */
export function liveInvites(list, now, ownCode = null) {
  return (Array.isArray(list) ? list : []).filter((entry) => !entry.declined && fresh(entry.savedAt, now)
    && entry.code !== ownCode);
}

/** Marks the given codes declined (or, with declined = false, clears the mark again). */
export function declineInvite(list, codes, declined = true) {
  const set = new Set(Array.isArray(codes) ? codes : [codes]);
  return (Array.isArray(list) ? list : []).map((entry) => {
    if (!set.has(entry.code)) return entry;
    const { declined: _old, ...rest } = entry;
    return declined ? { ...rest, declined: true } : rest;
  });
}

/** The list without that code (added, or permanently bad). */
export function removeInvite(list, code) {
  return (Array.isArray(list) ? list : []).filter((entry) => entry.code !== code);
}

/** Who the invite line is about: "Priya as a friend", "Priya and 2 more friends", "Priya and 1 more friend". */
export function inviteTarget(live) {
  const n = Array.isArray(live) ? live.length : 0;
  if (!n) return '';
  if (n === 1) return `${live[0].by || 'the friend who sent you the link'} as a friend`;
  return `${live[0].by || 'a friend'} and ${n - 1} more friend${n === 2 ? '' : 's'}`;
}

/** The notice after friends were added: one name, or a count. */
export function addedNotice(names) {
  const n = Array.isArray(names) ? names.length : 0;
  if (!n) return '';
  if (n === 1) return `You and ${names[0]} are now friends on the board`;
  return `You and ${n} friends are now connected on the board`;
}
