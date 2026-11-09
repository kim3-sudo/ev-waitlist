import { randomUUID } from 'node:crypto';

// Smart charging depth: time-of-day limits, dynamic capacity profiles (events), and phase-aware
// balancing. This module is pure (no database, no network) so the rules can be tested directly.
// services/loadBalance.js applies the results to the charge points.
//
// Terms used here:
//   - Schedule: a time-of-day window that caps the connectors in its scope (for example 16 A
//     between 17:00 and 21:00 on weekdays). Overnight windows (start after end) are allowed.
//   - Event (dynamic profile): a time-bounded change to the site's supply, per phase, such as a
//     utility curtailment. The supply on a phase is the lowest of its base capacity and any event
//     that is active now.
//   - Phase-aware balancing: each connector draws on the phases it is wired to (three-phase
//     connectors on all of L1, L2 and L3; single-phase connectors on one). A connector's limit is
//     chosen so that no phase carries more than its capacity.
//
// Amps are per phase. For a balanced three-phase charge point, the current on each phase equals
// the limit, so the same number is used on each phase.

export const MIN_AMPS = 6;
export const MAX_AMPS_LIMIT = 80;
export const PHASES = ['L1', 'L2', 'L3'];
const EPS = 1e-9;

// Day numbers follow Date.getDay(): 0 is Sunday.
const DAY_NAMES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export class SmartChargingConfigError extends Error {}

const fail = (message) => {
  throw new SmartChargingConfigError(message);
};

const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function isValidTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function normalizePhaseCapacity(raw, label) {
  if (raw == null) return null;
  if (typeof raw !== 'object') fail(`${label} must give an amp limit for each of L1, L2 and L3`);
  const out = {};
  for (const phase of PHASES) {
    const v = Number(raw[phase]);
    if (!Number.isFinite(v) || v < 0 || v > 100000) fail(`${label} ${phase} must be a number of amps from 0 up`);
    out[phase] = v;
  }
  return out;
}

// Checks and tidies a configuration from the admin API or the stored JSON. Throws
// SmartChargingConfigError with a message the admin can read.
export function normalizeConfig(raw = {}) {
  const timeZone = raw.timeZone ?? 'UTC';
  if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) fail('timeZone must be a valid IANA time zone, such as Europe/London');

  const phaseCapacityA = normalizePhaseCapacity(raw.phaseCapacityA, 'The phase capacity');

  const schedules = (raw.schedules ?? []).map((s) => {
    const name = String(s.name ?? '').trim();
    if (!name) fail('Each schedule needs a name');
    const days = [...new Set((s.days ?? []).map(Number))];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail(`Schedule "${name}" needs days from 0 (Sunday) to 6 (Saturday)`);
    if (!isTime(s.start) || !isTime(s.end)) fail(`Schedule "${name}" needs start and end times as HH:MM`);
    if (s.start === s.end) fail(`Schedule "${name}" must start and end at different times`);
    const limitAmps = Number(s.limitAmps);
    if (!Number.isInteger(limitAmps) || limitAmps < MIN_AMPS || limitAmps > MAX_AMPS_LIMIT) {
      fail(`Schedule "${name}" needs a limit in whole amps from ${MIN_AMPS} to ${MAX_AMPS_LIMIT}`);
    }
    const stationIds = [...new Set((s.stationIds ?? []).map(String))];
    return { id: s.id ? String(s.id) : randomUUID(), name, days, start: s.start, end: s.end, limitAmps, stationIds };
  });

  const events = (raw.events ?? []).map((e) => {
    const name = String(e.name ?? '').trim();
    if (!name) fail('Each event needs a name');
    const startsAt = new Date(e.startsAt);
    const endsAt = new Date(e.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail(`Event "${name}" needs a start and an end time`);
    if (endsAt <= startsAt) fail(`Event "${name}" must end after it starts`);
    const phaseCapacity = normalizePhaseCapacity(e.phaseCapacityA, `Event "${name}" capacity`);
    if (!phaseCapacity) fail(`Event "${name}" needs a capacity for each phase`);
    return {
      id: e.id ? String(e.id) : randomUUID(),
      name,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      phaseCapacityA: phaseCapacity,
    };
  });

  if (events.length && !phaseCapacityA) fail('Events change the site supply by phase, so the phase capacity must be set first');

  return { timeZone, phaseCapacityA, schedules, events };
}

// Reads the stored JSON. A broken value is treated as empty rather than stopping the balance.
export function parseStoredConfig(json) {
  if (!json) return normalizeConfig({});
  try {
    return normalizeConfig(JSON.parse(json));
  } catch {
    return normalizeConfig({});
  }
}

// The local day and minute of a moment in a time zone.
export function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: DAY_NAMES[get('weekday')], minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Does a schedule's window cover this local moment? An overnight window belongs to the day it starts on.
export function windowCovers(schedule, clock) {
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  if (start < end) {
    return schedule.days.includes(clock.day) && clock.minute >= start && clock.minute < end;
  }
  const inFirstPart = clock.minute >= start && schedule.days.includes(clock.day);
  const inSecondPart = clock.minute < end && schedule.days.includes((clock.day + 6) % 7);
  return inFirstPart || inSecondPart;
}

// The schedule that is in force for a charge point at this moment: the one with the lowest limit
// (the ceiling), or null when no schedule applies.
export function activeScheduleAt(config, stationId, date) {
  const clock = localClock(date, config.timeZone);
  let active = null;
  for (const s of config.schedules) {
    if (s.stationIds.length && !s.stationIds.includes(stationId)) continue;
    if (!windowCovers(s, clock)) continue;
    if (!active || s.limitAmps < active.limitAmps) active = s;
  }
  return active;
}

// The most restrictive schedule limit that applies to a charge point at this moment, or null.
export function scheduleCapAt(config, stationId, date) {
  return activeScheduleAt(config, stationId, date)?.limitAmps ?? null;
}

// A manual limit above the schedule ceiling is held down to the ceiling while the schedule runs.
// Returns the warning to show the admin, or null when the manual limit is at or below the ceiling.
export function manualLimitCeilingWarning({ manualAmps, schedule }) {
  if (manualAmps == null || !schedule || manualAmps <= schedule.limitAmps) return null;
  return `The manual limit of ${manualAmps} A is above the schedule "${schedule.name}", which holds the connector to ${schedule.limitAmps} A until ${schedule.end}. The schedule is in effect, so the manual limit is not applied while it runs.`;
}

// The site supply per phase at this moment. Infinity means no limit on that phase.
export function phaseCapacityAt(config, date) {
  const capacity = {};
  for (const phase of PHASES) capacity[phase] = config.phaseCapacityA ? config.phaseCapacityA[phase] : Infinity;
  for (const e of config.events) {
    if (date < new Date(e.startsAt) || date >= new Date(e.endsAt)) continue;
    for (const phase of PHASES) capacity[phase] = Math.min(capacity[phase], e.phaseCapacityA[phase]);
  }
  return capacity;
}

// The phases a connector draws on. A three-phase connector uses all three. A single-phase
// connector uses its own phase, L1 when none is set. An unknown connector is counted on every
// phase, which is the safe choice for the supply.
export function connectorPhases(connector) {
  if (connector.phaseCount === 1) return [connector.phase && PHASES.includes(connector.phase) ? connector.phase : 'L1'];
  return [...PHASES];
}

// Chooses each connector's limit so that no phase is loaded above its capacity, and the supply is
// shared fairly.
//
// Method: progressive filling (max-min fairness). Every active connector is raised together until
// it reaches its own maximum or a phase it uses runs out of capacity. Connectors that reach either
// are fixed at that level, and the rest keep rising. Idle connectors keep their maximum, so the
// next car starts at full power.
//
// Input:  { capacityA: {L1,L2,L3} (Infinity = no limit), connectors: [{ key, active, maxAmps, phases }] }
// Output: { limits: [{ key, limitAmps, active }], overCapacity, saturatedPhases }
export function planPhaseLimits({ capacityA, connectors }) {
  const capOf = (c) => Math.max(0, Math.floor(c.maxAmps));
  const active = connectors.filter((c) => c.active);

  // Even at the minimum, some phase may not fit every active connector.
  let overCapacity = false;
  for (const phase of PHASES) {
    const users = active.filter((c) => c.phases.includes(phase)).length;
    if (users * MIN_AMPS > capacityA[phase] + EPS) overCapacity = true;
  }

  const level = new Map(); // key -> amps, for every active connector
  const frozen = new Set();
  const frozenLoad = { L1: 0, L2: 0, L3: 0 };
  const saturated = new Set();
  let t = MIN_AMPS;
  let remaining = active.slice();

  while (remaining.length) {
    // The next level at which something stops rising.
    let next = Infinity;
    for (const c of remaining) next = Math.min(next, capOf(c));
    const phaseLevel = {};
    for (const phase of PHASES) {
      const users = remaining.filter((c) => c.phases.includes(phase)).length;
      phaseLevel[phase] = users ? (capacityA[phase] - frozenLoad[phase]) / users : Infinity;
      next = Math.min(next, phaseLevel[phase]);
    }
    t = Math.max(t, next); // at least the minimum; below that the site is over capacity

    const full = new Set(PHASES.filter((p) => phaseLevel[p] <= t + EPS));
    const stop = [];
    const keep = [];
    for (const c of remaining) {
      if (capOf(c) <= t + EPS || c.phases.some((p) => full.has(p))) stop.push(c);
      else keep.push(c);
    }
    for (const p of full) if (Number.isFinite(capacityA[p])) saturated.add(p);
    for (const c of stop) {
      const amps = Math.min(capOf(c), t);
      level.set(c.key, amps);
      frozen.add(c.key);
      for (const p of c.phases) frozenLoad[p] += amps;
    }
    remaining = keep;
  }

  const limits = connectors.map((c) => {
    const cap = capOf(c);
    if (!c.active) return { key: c.key, limitAmps: cap, active: false };
    const exact = level.get(c.key);
    // Round down to whole amps so the phases never carry more than their capacity. Keep at least
    // the connector's own maximum when that is below the minimum.
    const floored = Math.floor(exact + EPS);
    return { key: c.key, limitAmps: Math.min(cap, Math.max(Math.min(MIN_AMPS, cap), floored)), active: true };
  });

  return { limits, overCapacity, saturatedPhases: [...saturated].sort() };
}
