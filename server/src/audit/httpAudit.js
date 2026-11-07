import { recordAudit } from './record.js';

// Records what the admin app and the API do to the installation, without each route having to
// remember to. Changes are recorded whether they succeed or fail, and refused requests (401,
// 403) are recorded too. Successful reads are not recorded.
//
// Routes that record their own, richer event (recordAudit(..., { res })) are skipped here.
//
// Generic events name the action from the URL, for example admin.zones.create or
// admin.station-commands.reset. Only field names are captured, never values. The important
// changes have their own events with before and after values.

// Path segments that identify a record: they contain a digit, or look like a cuid or a UUID.
const ID_LIKE = /^(?=.*\d)[A-Za-z0-9_-]{8,}$|^[a-z0-9]{20,}$|^[0-9a-f-]{32,}$/i;
const VERB_BY_METHOD = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

function describeRequest(req) {
  const segments = req.originalUrl.split('?')[0].split('/').filter(Boolean); // api, admin|v1, ...
  const area = segments[1] === 'admin' ? 'admin' : 'api.v1';
  const rest = segments.slice(2);
  const ids = rest.filter((s) => ID_LIKE.test(s));
  const words = rest.filter((s) => !ID_LIKE.test(s));
  if (words.length === 1 && VERB_BY_METHOD[req.method]) words.push(VERB_BY_METHOD[req.method]);
  return { action: [area, ...(words.length ? words : ['request'])].join('.'), targetId: ids[0] ?? null };
}

function actorOf(req) {
  const sub = req.admin?.sub;
  if (sub?.startsWith('service-account:')) {
    return { actorType: 'SERVICE_ACCOUNT', actorId: req.admin.serviceAccountId, actorLabel: req.admin.name };
  }
  if (sub) return { actorType: 'ADMIN', actorId: sub, actorLabel: req.admin.email ?? null };
  return { actorType: 'ANONYMOUS', actorId: null, actorLabel: null };
}

export function auditHttp(req, res, next) {
  res.on('finish', () => {
    try {
      if (res.locals.auditRecorded) return;
      const status = res.statusCode;
      const denied = status === 401 || status === 403;
      const isRead = req.method === 'GET' || req.method === 'HEAD';
      if (isRead && !denied) return;

      const { action, targetId } = describeRequest(req);
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const fields = Object.keys(body);

      recordAudit({
        tenantId: req.admin?.tenantId ?? null,
        ...actorOf(req),
        action,
        targetType: 'request',
        targetId,
        outcome: denied ? 'DENIED' : status < 400 ? 'SUCCESS' : 'FAILED',
        reason: `HTTP ${status}`,
        changes: fields.length ? { fields } : null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.headers['x-request-id'],
      });
    } catch (err) {
      console.error('[audit] could not describe a request:', err.message);
    }
  });
  next();
}
