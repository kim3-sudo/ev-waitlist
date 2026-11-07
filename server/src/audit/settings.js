import { rawPrisma } from '../db.js';
import { IP_LOGGING_LEVELS } from './ipPolicy.js';

export const DEFAULT_RETENTION_DAYS = 30;
export const RETENTION_OPTIONS = [7, 30, 90, 180, 365, 730];

let cached = null;

// The installation's audit settings. Created with the defaults on first use.
export async function getAuditSettings() {
  if (cached) return cached;
  const row = await rawPrisma.auditSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  cached = { retentionDays: row.retentionDays, ipLogging: row.ipLogging };
  return cached;
}

export async function updateAuditSettings({ retentionDays, ipLogging }) {
  const data = {};
  if (retentionDays !== undefined) {
    if (!RETENTION_OPTIONS.includes(retentionDays)) {
      return { error: `Retention must be one of ${RETENTION_OPTIONS.join(', ')} days` };
    }
    data.retentionDays = retentionDays;
  }
  if (ipLogging !== undefined) {
    if (!IP_LOGGING_LEVELS.includes(ipLogging)) return { error: 'IP logging must be FULL, TRUNCATED, or NONE' };
    data.ipLogging = ipLogging;
  }
  const row = await rawPrisma.auditSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });
  cached = null;
  return { value: { retentionDays: row.retentionDays, ipLogging: row.ipLogging } };
}

// For tests and for changes made outside this module.
export function clearAuditSettingsCache() {
  cached = null;
}
