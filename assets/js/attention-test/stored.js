// Browser memory for the Attention Test: the last and the best finished run on this device, so a visitor who
// closes the page can still share the score or put it on the leaderboard later. Device-only; no server calls.
//
// Only the RAW run is stored, never a score. Every read re-checks and re-scores it with scoring.js, so an edited
// entry or one from another scoring version is dropped instead of showing a number the game never gave.
// Every storage access is wrapped: private mode or blocked storage just means nothing is remembered.
//
//   localStorage['clarus.attentionTest.lastRun'] = JSON {"run": <raw v2 run>, "at": <Date.now() when finished>}
//   localStorage['clarus.attentionTest.bestRun'] = the same shape, replaced only by a higher overall score

import { SCORING_VERSION, scoreRun, checkRun } from './scoring.js?v=2';

export const LAST_KEY = 'clarus.attentionTest.lastRun';
export const BEST_KEY = 'clarus.attentionTest.bestRun';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The last score is shown, and the leaderboard offered, only for runs younger than this. */
export const MAX_AGE_MS = 7 * DAY_MS;
/** A finish time further in the future than this (a wrong clock) is not trusted. */
const FUTURE_SLACK_MS = DAY_MS;

/** window.localStorage, or null when there is none or reading it throws. */
export function browserStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

/**
 * Checks a stored entry and scores it. Returns { run, at, result } or null when the entry is missing, has the
 * wrong shape, fails checkRun, can't be scored, or comes from another scoring version.
 */
export function validEntry(entry, now = Date.now()) {
  try {
    if (!entry || typeof entry !== 'object') return null;
    const { run, at } = entry;
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now + FUTURE_SLACK_MS) return null;
    if (!run || typeof run !== 'object' || run.v !== SCORING_VERSION) return null;
    if (checkRun(run) !== null) return null;
    const result = scoreRun(run);
    if (!result || !result.valid || result.version !== SCORING_VERSION || !Number.isInteger(result.overall)) return null;
    return { run, at, result };
  } catch (_) {
    return null;
  }
}

function removeKey(storage, key) {
  try {
    if (storage) storage.removeItem(key);
  } catch (_) {
    /* blocked storage */
  }
}

/** Reads and validates one key. A broken or invalid entry is removed so it stops costing a parse each load. */
export function readEntry(storage, key, now = Date.now()) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (_) {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    parsed = null;
  }
  const entry = validEntry(parsed, now);
  if (!entry) removeKey(storage, key);
  return entry;
}

function writeEntry(storage, key, run, at) {
  try {
    storage.setItem(key, JSON.stringify({ run, at }));
    return true;
  } catch (_) {
    return false; // private mode, full or blocked storage
  }
}

/**
 * Saves a finished run as the last run, and as the best when its overall score beats the stored best
 * (which is re-scored first). Returns { last, best }: whether each key was written.
 */
export function saveRun(run, { storage = browserStorage(), now = Date.now() } = {}) {
  const out = { last: false, best: false };
  if (!storage) return out;
  const entry = validEntry({ run, at: now }, now);
  if (!entry) return out;
  out.last = writeEntry(storage, LAST_KEY, run, now);
  const best = readEntry(storage, BEST_KEY, now);
  if (!best || entry.result.overall > best.result.overall) out.best = writeEntry(storage, BEST_KEY, run, now);
  return out;
}

/**
 * The stored runs to show: { best, last }, each { run, at, result } or null.
 * `last` is null when it is older than MAX_AGE_MS or is the same run as `best`.
 * `best` never expires (it is re-validated on every load).
 */
export function loadStored({ storage = browserStorage(), now = Date.now() } = {}) {
  const storedBest = readEntry(storage, BEST_KEY, now);
  let last = readEntry(storage, LAST_KEY, now);
  // If the best key was lost or its write failed, the last run may be the best we know.
  const best = storedBest && (!last || storedBest.result.overall >= last.result.overall) ? storedBest : last;
  if (last && (last === best || now - last.at >= MAX_AGE_MS || (best && last.at === best.at))) last = null;
  return { best, last };
}

/** Whether a stored run is recent enough to offer for the leaderboard. */
export function canJoin(entry, now = Date.now()) {
  return !!entry && now - entry.at < MAX_AGE_MS;
}

/** Forgets both stored runs. */
export function clearStored(storage = browserStorage()) {
  removeKey(storage, LAST_KEY);
  removeKey(storage, BEST_KEY);
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", or a date for anything older. */
export function agoText(at, now = Date.now()) {
  const ms = Math.max(0, now - at);
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  try {
    return `on ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  } catch (_) {
    return `${d} days ago`;
  }
}
