// A sliding-window counter kept in memory. Each key (an address, an account, a session) has
// the count for the current window and the one before it; the earlier window counts less the
// further the current one has moved on. That avoids the double burst a fixed window allows
// at its edge, and needs two numbers per key.
//
// The counts live in this process. With several server processes, each keeps its own, so the
// real limit is up to (limit x processes). Settings are shared, through the database.

const MAX_KEYS_PER_RULE = 200_000;
const SWEEP_MS = 60_000;

// rule name -> { windowMs, keys: Map(key -> { start, count, prev }) }
const rules = new Map();
let sweeper = null;

function bucket(rule, windowMs) {
  let b = rules.get(rule);
  if (!b) {
    b = { windowMs, keys: new Map() };
    rules.set(rule, b);
  }
  b.windowMs = windowMs;
  startSweeper();
  return b;
}

// Moves an entry forward to the window `now` falls in.
function roll(entry, windowMs, now) {
  const elapsed = now - entry.start;
  if (elapsed >= 2 * windowMs) {
    entry.start = now;
    entry.count = 0;
    entry.prev = 0;
  } else if (elapsed >= windowMs) {
    entry.prev = entry.count;
    entry.count = 0;
    entry.start += windowMs;
  }
}

function weighted(entry, windowMs, now) {
  const fraction = Math.min(1, (now - entry.start) / windowMs);
  return entry.prev * (1 - fraction) + entry.count;
}

function entryFor(b, key, now, create) {
  let entry = b.keys.get(key);
  if (!entry) {
    if (!create) return null;
    if (b.keys.size >= MAX_KEYS_PER_RULE) {
      // Drop the oldest tenth. Map keeps insertion order, so these were added first.
      let drop = Math.ceil(MAX_KEYS_PER_RULE / 10);
      for (const k of b.keys.keys()) {
        b.keys.delete(k);
        if (--drop <= 0) break;
      }
    }
    entry = { start: now, count: 0, prev: 0 };
    b.keys.set(key, entry);
  }
  roll(entry, b.windowMs, now);
  return entry;
}

// Milliseconds until one more request would be allowed.
function waitMs(entry, limit, windowMs, now) {
  const toEnd = Math.max(1, entry.start + windowMs - now);
  if (entry.count >= limit - 1 || entry.prev === 0) return toEnd;
  // The earlier window's share shrinks as time passes: wait until the total drops below limit - 1.
  const needFraction = 1 - (limit - 1 - entry.count) / entry.prev;
  return Math.min(toEnd, Math.max(1, needFraction * windowMs - (now - entry.start)));
}

function result(entry, limit, windowMs, now, allowed) {
  const used = weighted(entry, windowMs, now);
  return {
    allowed,
    limit,
    remaining: Math.max(0, Math.floor(limit - used)),
    retryAfterMs: allowed ? 0 : waitMs(entry, limit, windowMs, now),
  };
}

// Counts one request for `key` unless it is already at the limit. A refused request is not
// counted, so hammering a blocked key does not keep it blocked for longer.
export function consume(rule, key, { limit, windowMs }, now = Date.now()) {
  const b = bucket(rule, windowMs);
  const entry = entryFor(b, key, now, true);
  const allowed = weighted(entry, windowMs, now) < limit;
  if (allowed) entry.count += 1;
  return result(entry, limit, windowMs, now, allowed);
}

// Whether `key` is at the limit, without counting anything.
export function peek(rule, key, { limit, windowMs }, now = Date.now()) {
  const b = bucket(rule, windowMs);
  const entry = entryFor(b, key, now, false);
  if (!entry) return { allowed: true, limit, remaining: limit, retryAfterMs: 0 };
  return result(entry, limit, windowMs, now, weighted(entry, windowMs, now) < limit);
}

// Counts one event for `key` whether or not it is over the limit (for failures seen after the fact).
export function record(rule, key, { windowMs }, now = Date.now()) {
  const entry = entryFor(bucket(rule, windowMs), key, now, true);
  entry.count += 1;
}

export function resetLimiter() {
  rules.clear();
}

// Forgets keys that have been quiet for two windows.
export function sweep(now = Date.now()) {
  for (const [name, b] of rules) {
    for (const [key, entry] of b.keys) {
      if (now - entry.start >= 2 * b.windowMs) b.keys.delete(key);
    }
    if (b.keys.size === 0) rules.delete(name);
  }
}

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => sweep(), SWEEP_MS);
  sweeper.unref?.();
}
