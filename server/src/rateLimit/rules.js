import { rawPrisma } from '../db.js';

// The rate limits, and where an administrator's changes to them are kept. The limits are for the
// whole installation, because they apply before a request is tied to a site (a sign-in, for
// instance). Only values that differ from the defaults are stored.
//
// A rule is a count over a window of time. `by` is who the count is kept for:
//   ip       the address the request came from
//   account  the account being signed in to (counts failed attempts only)
//   session  the sign-in token or API key on the request
// `kind: 'concurrent'` rules cap how many are open at once, so they have no window.

export const RULE_DEFS = {
  'general.ip': {
    label: 'All API requests, per address',
    description: 'A backstop for every API request from one address. Payment provider webhooks and the health check are exempt.',
    by: 'ip', limit: 600, windowSeconds: 60, minLimit: 30,
  },
  'authenticated.session': {
    label: 'Admin app and API requests, per sign-in or API key',
    description: 'Requests made with one admin session or API key.',
    by: 'session', limit: 1200, windowSeconds: 60, minLimit: 30,
  },
  'login.ip': {
    label: 'Password sign-in attempts, per address',
    description: 'Every attempt to sign in with a password from one address, right or wrong.',
    by: 'ip', limit: 20, windowSeconds: 900, minLimit: 5,
  },
  'login.account': {
    label: 'Failed password sign-ins, per account',
    description: 'Wrong passwords for one e-mail address. Once reached, that account cannot sign in until the window passes, even with the right password.',
    by: 'account', limit: 10, windowSeconds: 900, minLimit: 3,
  },
  'mfa.ip': {
    label: 'Two-factor code attempts, per address',
    description: 'Every two-factor code submitted from one address, right or wrong.',
    by: 'ip', limit: 20, windowSeconds: 900, minLimit: 5,
  },
  'mfa.account': {
    label: 'Wrong two-factor codes, per account',
    description: 'Wrong two-factor codes for one account. Once reached, that account must wait before trying again.',
    by: 'account', limit: 5, windowSeconds: 900, minLimit: 3,
  },
  'signInCode.ip': {
    label: 'E-mailed sign-in code requests and attempts, per address',
    description: 'Requests for a driver sign-in code, and codes typed in, from one address.',
    by: 'ip', limit: 30, windowSeconds: 900, minLimit: 5,
  },
  'publicWrite.ip': {
    label: 'Driver actions that change something, per address',
    description: 'Joining or leaving the waitlist, starting a charge, reporting, and other changes made without signing in.',
    by: 'ip', limit: 60, windowSeconds: 60, minLimit: 5,
  },
  'deviceFiles.ip': {
    label: 'Charge point file transfers, per address',
    description: 'Firmware downloads and diagnostics uploads.',
    by: 'ip', limit: 60, windowSeconds: 60, minLimit: 5,
  },
  'liveStreams.ip': {
    label: 'Open live-update streams, per address',
    description: 'How many live-update connections one address can hold open at once.',
    by: 'ip', kind: 'concurrent', limit: 20, minLimit: 1,
  },
};

export const RULE_NAMES = Object.keys(RULE_DEFS);
export const MAX_LIMIT = 1_000_000;
export const MAX_WINDOW_SECONDS = 86_400;

// How long a process trusts what it loaded, so a change made through another process shows up soon.
const REFRESH_MS = 30_000;

let overrides = {};
let loadedAt = 0;

function effective(name) {
  const def = RULE_DEFS[name];
  const o = overrides[name] ?? {};
  return {
    enabled: o.enabled ?? true,
    limit: o.limit ?? def.limit,
    windowSeconds: def.kind === 'concurrent' ? null : (o.windowSeconds ?? def.windowSeconds),
  };
}

// The current settings of one rule. Never reads the database.
export function ruleSettings(name) {
  const e = effective(name);
  return { ...e, windowMs: e.windowSeconds === null ? null : e.windowSeconds * 1000 };
}

function parseStored(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    const clean = {};
    for (const name of RULE_NAMES) {
      if (parsed && typeof parsed[name] === 'object' && parsed[name] !== null) clean[name] = parsed[name];
    }
    return clean;
  } catch {
    return {};
  }
}

export async function loadRateLimits() {
  const row = await rawPrisma.rateLimitSettings.findUnique({ where: { id: 'singleton' } });
  overrides = parseStored(row?.rules);
  loadedAt = Date.now();
}

// Reloads when the copy in memory is old. If the database cannot be read, the last good copy is kept.
export async function ensureFresh() {
  if (Date.now() - loadedAt < REFRESH_MS) return;
  loadedAt = Date.now();
  try {
    await loadRateLimits();
  } catch (err) {
    console.error('[rate-limit] could not load settings; keeping the last ones:', err.message);
  }
}

// Forgets everything in memory (for tests). The next request loads from the database.
export function clearRateLimitCache() {
  overrides = {};
  loadedAt = 0;
}

export function rateLimitView() {
  return RULE_NAMES.map((name) => {
    const def = RULE_DEFS[name];
    const now = effective(name);
    return {
      name,
      label: def.label,
      description: def.description,
      by: def.by,
      kind: def.kind ?? 'window',
      enabled: now.enabled,
      limit: now.limit,
      windowSeconds: now.windowSeconds,
      default: { limit: def.limit, windowSeconds: def.kind === 'concurrent' ? null : def.windowSeconds },
      minLimit: def.minLimit,
      maxLimit: MAX_LIMIT,
      changed: Boolean(overrides[name] && Object.keys(overrides[name]).length),
    };
  });
}

// Checks a change before it is saved. `input` is { ruleName: { enabled?, limit?, windowSeconds? } }.
// Returns { value } with the cleaned changes, or { error }.
export function validateChanges(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'rules must be an object' };
  const value = {};
  for (const [name, change] of Object.entries(input)) {
    const def = RULE_DEFS[name];
    if (!def) return { error: `Unknown rule: ${name}` };
    if (!change || typeof change !== 'object' || Array.isArray(change)) return { error: `${name} must be an object` };
    const clean = {};
    for (const [field, v] of Object.entries(change)) {
      if (field === 'enabled') {
        if (typeof v !== 'boolean') return { error: `${name}: enabled must be true or false` };
        clean.enabled = v;
      } else if (field === 'limit') {
        if (!Number.isInteger(v) || v < def.minLimit || v > MAX_LIMIT) {
          return { error: `${name}: limit must be a whole number from ${def.minLimit} to ${MAX_LIMIT}` };
        }
        clean.limit = v;
      } else if (field === 'windowSeconds') {
        if (def.kind === 'concurrent') return { error: `${name} has no time window` };
        if (!Number.isInteger(v) || v < 1 || v > MAX_WINDOW_SECONDS) {
          return { error: `${name}: windowSeconds must be a whole number from 1 to ${MAX_WINDOW_SECONDS}` };
        }
        clean.windowSeconds = v;
      } else {
        return { error: `${name}: unknown field ${field}` };
      }
    }
    value[name] = clean;
  }
  return { value };
}

// Applies validated changes on top of what is stored. A value equal to the default is dropped, so
// a later change to the defaults still reaches rules nobody customised.
export async function saveChanges(changes) {
  const row = await rawPrisma.rateLimitSettings.findUnique({ where: { id: 'singleton' } });
  const merged = parseStored(row?.rules);
  for (const [name, change] of Object.entries(changes)) {
    const def = RULE_DEFS[name];
    const next = { ...(merged[name] ?? {}), ...change };
    if (next.enabled === true) delete next.enabled;
    if (next.limit === def.limit) delete next.limit;
    if (next.windowSeconds === def.windowSeconds) delete next.windowSeconds;
    if (Object.keys(next).length) merged[name] = next;
    else delete merged[name];
  }
  const rules = JSON.stringify(merged);
  await rawPrisma.rateLimitSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', rules },
    update: { rules },
  });
  overrides = merged;
  loadedAt = Date.now();
}

export async function resetToDefaults() {
  await rawPrisma.rateLimitSettings.deleteMany({ where: { id: 'singleton' } });
  overrides = {};
  loadedAt = Date.now();
}
