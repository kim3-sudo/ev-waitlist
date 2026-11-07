import { rawPrisma } from '../db.js';
import { getAuditSettings } from './settings.js';
import { isExporterEnabled } from './exporter.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Deletes events older than the installation's retention period. When the SIEM exporter is
// on, only events it has already delivered are deleted: an event that has not reached
// the SIEM is kept, however old it is. Returns the number of events deleted.
export async function sweepAudit(now = new Date()) {
  const { retentionDays } = await getAuditSettings();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const where = isExporterEnabled()
    ? { at: { lt: cutoff }, exportedAt: { not: null } }
    : { at: { lt: cutoff } };
  const result = await rawPrisma.auditEvent.deleteMany({ where });
  return result.count;
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function startAuditSweeper() {
  const timer = setInterval(() => {
    sweepAudit().catch((err) => console.error('Audit retention sweep failed:', err.message));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
