// Time-of-day rates. A schedule is a list of windows. Each window sets its own rate
// for the minutes that fall inside it, on the days it names. Minutes outside every
// window use the base rate. Windows may not overlap.
//
// Days are 0 = Sunday ... 6 = Saturday, in server local time (as the rest of the app).
// A window belongs to the day it starts on: { days: [5], startHour: 22, endHour: 6 }
// covers Friday 22:00 to midnight, and Saturday 00:00 to 06:00.
//
// Pure functions: no I/O, so they can be tested directly.

export const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const HOURS_PER_DAY = 24;
const CELLS = 7 * HOURS_PER_DAY;

// Hour cells (day * 24 + hour) that a window covers.
function cellsOf(rule) {
  const cells = [];
  const { startHour: start, endHour: end } = rule;
  for (const day of rule.days) {
    if (start < end) {
      for (let h = start; h < end; h += 1) cells.push(day * HOURS_PER_DAY + h);
    } else if (start > end) {
      for (let h = start; h < HOURS_PER_DAY; h += 1) cells.push(day * HOURS_PER_DAY + h);
      const next = (day + 1) % 7;
      for (let h = 0; h < end; h += 1) cells.push(next * HOURS_PER_DAY + h);
    }
  }
  return cells;
}

// Checks a schedule the admin entered. Returns { rules } (normalized) or { error }.
export function validateSchedule(input) {
  if (!Array.isArray(input)) return { error: 'rateSchedule must be a list of time windows' };
  if (input.length > 50) return { error: 'A schedule can have at most 50 time windows' };

  const rules = [];
  for (const [i, raw] of input.entries()) {
    const label = `Time window ${i + 1}`;
    if (raw == null || typeof raw !== 'object') return { error: `${label}: not a valid time window` };
    const days = Array.isArray(raw.days) ? [...new Set(raw.days)].sort((a, b) => a - b) : [];
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { error: `${label}: choose at least one day` };
    }
    const { startHour, endHour, rate } = raw;
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
      return { error: `${label}: start must be an hour from 0 to 23` };
    }
    if (!Number.isInteger(endHour) || endHour < 0 || endHour > 24) {
      return { error: `${label}: end must be an hour from 0 to 24` };
    }
    if (startHour === endHour) {
      return { error: `${label}: start and end can't be the same hour. Use 0 to 24 for a whole day.` };
    }
    if (!Number.isInteger(rate) || rate < 0) {
      return { error: `${label}: the rate must be a whole number of cents, 0 or more` };
    }
    rules.push({ days, startHour, endHour, rate });
  }

  const owner = new Array(CELLS).fill(-1);
  for (const [i, rule] of rules.entries()) {
    for (const cell of cellsOf(rule)) {
      if (owner[cell] !== -1) {
        const day = DAY_NAMES[Math.floor(cell / HOURS_PER_DAY)];
        const hour = cell % HOURS_PER_DAY;
        return {
          error: `Time windows ${owner[cell] + 1} and ${i + 1} overlap on ${day} at ${String(hour).padStart(2, '0')}:00`,
        };
      }
      owner[cell] = i;
    }
  }
  return { rules };
}

// The schedule that applies to a site. Sites that have not saved a schedule yet
// keep their old single peak window, which is read as one window on every day.
export function scheduleFor(settings) {
  if (settings.rateSchedule != null) {
    try {
      const parsed = JSON.parse(settings.rateSchedule);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const { peakRatePerMinuteCents: rate, peakStartHour: startHour, peakEndHour: endHour } = settings;
  if (rate == null || startHour == null || endHour == null || startHour === endHour) return [];
  return [{ days: [0, 1, 2, 3, 4, 5, 6], startHour, endHour, rate }];
}

// The rate for every hour of the week, given the base rate and the windows.
export function rateGrid(base, rules) {
  const grid = new Array(CELLS).fill(base);
  for (const rule of rules) {
    for (const cell of cellsOf(rule)) grid[cell] = rule.rate;
  }
  return grid;
}

// The rate in effect at a moment, from the grid.
export function rateAt(grid, date) {
  return grid[date.getDay() * HOURS_PER_DAY + date.getHours()];
}

// Whether one window is in effect at a moment (server local time, as rateAt). An
// overnight window's evening part belongs to the day it starts on, its morning part to the next day.
export function windowActiveAt(rule, date) {
  const day = date.getDay();
  const hour = date.getHours();
  const { days, startHour: start, endHour: end } = rule;
  if (start < end) return days.includes(day) && hour >= start && hour < end;
  return (days.includes(day) && hour >= start) || (days.includes((day + 6) % 7) && hour < end);
}

// The highest rate that applies at any time (the base rate, or a window's rate).
export function highestRate(grid) {
  return Math.max(...grid);
}
