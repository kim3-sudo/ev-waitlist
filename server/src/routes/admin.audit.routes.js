import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { recordAudit, auditFailures } from '../audit/record.js';
import { verifyChain } from '../audit/chain.js';
import { getAuditSettings, updateAuditSettings, RETENTION_OPTIONS } from '../audit/settings.js';
import { IP_LOGGING_LEVELS } from '../audit/ipPolicy.js';
import { currentExporter } from '../audit/exporter.js';
import { readLimit, decodeCursor, pageOf, MAX_LIMIT } from '../pagination.js';
import { requireInstanceAdmin } from '../auth/auth.middleware.js';

// The audit log. Mounted behind audit.view; the export and exporter status need audit.export,
// and changing the settings needs the installation administrator with system.manage.
export const adminAuditRouter = Router();

const need = (permission) => (req, res, next) =>
  req.admin.permissions.includes(permission)
    ? next()
    : res.status(403).json({ error: 'Your role does not allow this', missing: [permission] });

// A site's admins see their site's events. The installation administrator also sees the
// installation-wide events (sites, the operator, network-wide settings).
function scopeWhere(req) {
  const or = [{ tenantId: req.admin.tenantId }];
  if (req.admin.instanceAdmin) or.push({ tenantId: null });
  return { OR: or };
}

// Filters from the query string. Returns a Prisma where clause, or { error }.
function filtersFrom(query) {
  const where = [];
  if (typeof query.action === 'string' && query.action) where.push({ action: { startsWith: query.action.slice(0, 120) } });
  if (typeof query.outcome === 'string' && query.outcome) where.push({ outcome: query.outcome.slice(0, 20) });
  if (typeof query.actor === 'string' && query.actor) {
    const text = query.actor.slice(0, 191);
    where.push({ OR: [{ actorLabel: { contains: text } }, { actorId: text }] });
  }
  if (typeof query.target === 'string' && query.target) where.push({ targetId: query.target.slice(0, 191) });
  for (const [key, bound] of [['from', 'gte'], ['to', 'lte']]) {
    if (query[key] === undefined || query[key] === '') continue;
    const when = new Date(query[key]);
    if (Number.isNaN(when.getTime())) return { error: `${key} must be a date and time` };
    where.push({ at: { [bound]: when } });
  }
  return { where };
}

function serialize(row) {
  return {
    seq: row.seq,
    id: row.id,
    at: row.at,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    outcome: row.outcome,
    reason: row.reason,
    changes: row.changes ? JSON.parse(row.changes) : null,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    prevHash: row.prevHash,
    hash: row.hash,
    exportedAt: row.exportedAt,
  };
}

// Newest first. The cursor is the sequence number of the last event on the page.
async function eventsPage(req, { limit, cursorSeq }) {
  const filters = filtersFrom(req.query);
  if (filters.error) return { error: filters.error };
  const after = cursorSeq === null ? {} : { seq: { lt: cursorSeq } };
  const rows = await rawPrisma.auditEvent.findMany({
    where: { AND: [scopeWhere(req), ...filters.where, after] },
    orderBy: { seq: 'desc' },
    take: limit + 1,
  });
  return { page: pageOf(rows, limit, (row) => ({ v: row.seq, i: row.id })) };
}

adminAuditRouter.get('/events', need('audit.view'), async (req, res) => {
  const limit = readLimit(req.query);
  if (limit.error) return res.status(400).json({ error: limit.error });
  let cursorSeq = null;
  if (req.query.cursor) {
    const position = decodeCursor(req.query.cursor);
    if (!position || !Number.isInteger(position.v)) return res.status(400).json({ error: 'The cursor is not valid' });
    cursorSeq = position.v;
  }
  const result = await eventsPage(req, { limit: limit.value, cursorSeq });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ data: result.page.data.map(serialize), nextCursor: result.page.nextCursor });
});

const CSV_COLUMNS = [
  'seq', 'at', 'actorType', 'actorId', 'actorLabel', 'action', 'targetType', 'targetId', 'targetLabel',
  'outcome', 'reason', 'changes', 'ip', 'userAgent', 'requestId', 'prevHash', 'hash', 'exportedAt',
];

// Protects spreadsheets from treating a cell as a formula.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

adminAuditRouter.get('/events/export', need('audit.export'), async (req, res) => {
  const filters = filtersFrom(req.query);
  if (filters.error) return res.status(400).json({ error: filters.error });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.write(`${CSV_COLUMNS.join(',')}\r\n`);

  let cursorSeq = null;
  let total = 0;
  for (;;) {
    const rows = await rawPrisma.auditEvent.findMany({
      where: { AND: [scopeWhere(req), ...filters.where, cursorSeq === null ? {} : { seq: { lt: cursorSeq } }] },
      orderBy: { seq: 'desc' },
      take: MAX_LIMIT,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      res.write(`${CSV_COLUMNS.map((c) => csvCell(row[c])).join(',')}\r\n`);
    }
    total += rows.length;
    cursorSeq = rows[rows.length - 1].seq;
    if (rows.length < MAX_LIMIT) break;
  }

  recordAudit(
    {
      tenantId: req.admin.tenantId,
      actorType: 'ADMIN',
      actorId: req.admin.sub,
      actorLabel: req.admin.email ?? null,
      action: 'audit.export',
      targetType: 'audit_log',
      outcome: 'SUCCESS',
      reason: `${total} events`,
      changes: { filters: Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
  res.end();
});

adminAuditRouter.get('/verify', need('audit.view'), async (req, res) => {
  const result = await verifyChain();
  recordAudit(
    {
      tenantId: req.admin.tenantId,
      actorType: 'ADMIN',
      actorId: req.admin.sub,
      actorLabel: req.admin.email ?? null,
      action: 'audit.verify',
      targetType: 'audit_log',
      outcome: result.ok ? 'SUCCESS' : 'FAILED',
      reason: result.ok ? `${result.checked} events intact` : `${result.problem} at event ${result.atSeq}`,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
  res.json(result);
});

adminAuditRouter.get('/settings', need('audit.view'), async (req, res) => {
  res.json({
    ...(await getAuditSettings()),
    retentionOptions: RETENTION_OPTIONS,
    ipLoggingOptions: IP_LOGGING_LEVELS,
    instanceWide: true,
    canChange: Boolean(req.admin.instanceAdmin && req.admin.permissions.includes('system.manage')),
  });
});

adminAuditRouter.put('/settings', requireInstanceAdmin, need('system.manage'), async (req, res) => {
  const before = await getAuditSettings();
  const result = await updateAuditSettings(req.body ?? {});
  if (result.error) return res.status(400).json({ error: result.error });

  const changes = {};
  for (const key of ['retentionDays', 'ipLogging']) {
    if (before[key] !== result.value[key]) changes[key] = { from: before[key], to: result.value[key] };
  }
  if (Object.keys(changes).length) {
    recordAudit(
      {
        tenantId: req.admin.tenantId,
        actorType: 'ADMIN',
        actorId: req.admin.sub,
        actorLabel: req.admin.email ?? null,
        action: 'audit.settings.update',
        targetType: 'audit_settings',
        targetId: 'singleton',
        outcome: 'SUCCESS',
        changes,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      { res },
    );
  }
  res.json({ ...result.value, retentionOptions: RETENTION_OPTIONS, ipLoggingOptions: IP_LOGGING_LEVELS, instanceWide: true, canChange: true });
});

adminAuditRouter.get('/exporter', need('audit.export'), async (req, res) => {
  const exporter = currentExporter();
  const failures = auditFailures();
  if (!exporter) {
    return res.json({ enabled: false, recordingFailures: failures.count, lastRecordingFailure: failures.last });
  }
  res.json({ ...(await exporter.status()), recordingFailures: failures.count, lastRecordingFailure: failures.last });
});
