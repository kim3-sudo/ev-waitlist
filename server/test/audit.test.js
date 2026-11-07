import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { recordAudit, flushAudit, redactChanges, auditFailures } from '../src/audit/record.js';
import { verifyChain, GENESIS_HASH } from '../src/audit/chain.js';
import { truncateIp } from '../src/audit/ipPolicy.js';
import { sweepAudit } from '../src/audit/retention.js';
import { updateAuditSettings, clearAuditSettingsCache } from '../src/audit/settings.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';

const PASSWORD = 'Password123!';
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function tokenFor(admin) {
  const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

// An admin whose role holds exactly `permissions`.
async function adminWith(permissions, { instanceAdmin = false, tenantId = DEFAULT_TENANT_ID } = {}) {
  const roleName = `Role ${Math.random().toString(36).slice(2, 8)}`;
  await prisma.customRole.create({ data: { name: roleName, permissions: JSON.stringify(permissions) } });
  const admin = await createAdmin({ password: PASSWORD });
  await rawPrisma.admin.update({ where: { id: admin.id }, data: { role: roleName, instanceAdmin, tenantId } });
  return { admin, token: await tokenFor(admin) };
}

function event(overrides = {}) {
  return { actorType: 'SYSTEM', action: 'test.event', outcome: 'SUCCESS', tenantId: DEFAULT_TENANT_ID, ...overrides };
}

beforeEach(async () => {
  // Let the previous request's audit write (it is queued after the response ends) finish first.
  await new Promise((resolve) => setImmediate(resolve));
  await flushAudit();
  await resetDb();
  clearAuditSettingsCache();
});

describe('redacting changes', () => {
  it('records secret fields as [set] or [cleared], never their value', () => {
    const out = redactChanges({
      apiKey: { from: 'old-secret', to: 'new-secret' },
      password: { from: 'a', to: '' },
      name: { from: 'Bay 1', to: 'Bay 2' },
    });
    assert.deepEqual(out.apiKey, { from: '[set]', to: '[set]' });
    assert.deepEqual(out.password, { from: '[set]', to: '[cleared]' });
    assert.deepEqual(out.name, { from: 'Bay 1', to: 'Bay 2' });
    assert.ok(!JSON.stringify(out).includes('new-secret'));
  });
});

describe('IP logging level', () => {
  it('keeps everything, truncates, or drops, as chosen', () => {
    assert.equal(truncateIp('203.0.113.77', 'FULL'), '203.0.113.77');
    assert.equal(truncateIp('203.0.113.77', 'TRUNCATED'), '203.0.113.0');
    assert.equal(truncateIp('::ffff:203.0.113.77', 'TRUNCATED'), '203.0.113.0');
    assert.equal(truncateIp('2001:db8:1:2:3:4:5:6', 'TRUNCATED'), '2001:db8:1::');
    assert.equal(truncateIp('203.0.113.77', 'NONE'), null);
    assert.equal(truncateIp(undefined, 'FULL'), null);
  });

  it('applies the chosen level to new events', async () => {
    await updateAuditSettings({ ipLogging: 'TRUNCATED' });
    clearAuditSettingsCache();
    await recordAudit(event({ ip: '198.51.100.9' }));
    const row = await rawPrisma.auditEvent.findFirst();
    assert.equal(row.ip, '198.51.100.0');
  });
});

describe('hash chain', () => {
  async function writeThree() {
    for (const action of ['a.one', 'a.two', 'a.three']) await recordAudit(event({ action }));
    await flushAudit();
  }

  it('links every event to the one before, starting from the genesis hash', async () => {
    await writeThree();
    const rows = await rawPrisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
    assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3]);
    assert.equal(rows[0].prevHash, GENESIS_HASH);
    assert.equal(rows[1].prevHash, rows[0].hash);
    assert.equal(rows[2].prevHash, rows[1].hash);
    assert.equal((await verifyChain()).ok, true);
  });

  it('detects a changed event', async () => {
    await writeThree();
    await rawPrisma.auditEvent.update({ where: { seq: 2 }, data: { outcome: 'FAILED' } });
    const result = await verifyChain();
    assert.equal(result.ok, false);
    assert.equal(result.problem, 'ROW_CHANGED');
    assert.equal(result.atSeq, 2);
  });

  it('detects a removed event', async () => {
    await writeThree();
    await rawPrisma.auditEvent.delete({ where: { seq: 2 } });
    const result = await verifyChain();
    assert.equal(result.ok, false);
    assert.equal(result.problem, 'MISSING_ROWS');
    assert.equal(result.atSeq, 3);
  });

  it('detects an event whose link was rewritten to hide a change', async () => {
    await writeThree();
    // Rewriting seq 2 and its own hash still leaves seq 3 pointing at the original hash.
    await rawPrisma.auditEvent.update({ where: { seq: 2 }, data: { reason: 'edited' } });
    const result = await verifyChain();
    assert.equal(result.ok, false);
  });
});

describe('recording never fails the request', () => {
  it('logs the action that could not be recorded and resolves', async () => {
    const logged = mock.method(console, 'error', () => {});
    // A site that does not exist breaks the foreign key, so the write fails.
    const row = await recordAudit(event({ action: 'doomed.write', tenantId: 'no-such-site' }));
    assert.equal(row, null);
    assert.ok(logged.mock.calls.some((c) => String(c.arguments[0]).includes('doomed.write')));
    assert.ok(auditFailures().count >= 1);
    logged.mock.restore();
  });
});

describe('HTTP capture', () => {
  it('records a change with field names only, and records refusals', async () => {
    const { token } = await adminWith(['stations.view', 'zones.manage', 'zones.view']);
    const created = await request(app).post('/api/admin/zones').set(bearer(token)).send({ name: 'Secret Garage' });
    assert.equal(created.status, 201);

    await flushAudit();
    const row = await rawPrisma.auditEvent.findFirst({ where: { action: 'admin.zones.create' } });
    assert.ok(row, 'change recorded');
    assert.equal(row.outcome, 'SUCCESS');
    assert.deepEqual(JSON.parse(row.changes), { fields: ['name'] });
    assert.ok(!JSON.stringify(row).includes('Secret Garage'), 'values are not recorded');

    // An admin who can only view zones is refused a change, and the refusal is recorded.
    const viewer = await adminWith(['zones.view']);
    const denied = await request(app).delete('/api/admin/zones/nope').set(bearer(viewer.token));
    assert.equal(denied.status, 403);
    await flushAudit();
    assert.ok(await rawPrisma.auditEvent.findFirst({ where: { outcome: 'DENIED', actorId: viewer.admin.id } }));
  });

  it('does not record reads', async () => {
    const { token } = await adminWith(['zones.view']);
    await request(app).get('/api/admin/zones').set(bearer(token));
    await flushAudit();
    // Only the sign-in above is recorded, not the read.
    assert.equal(await rawPrisma.auditEvent.count({ where: { action: { startsWith: 'admin.' } } }), 0);
  });

  it('records a failed sign-in, without the password', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'wrong-guess-123' });
    assert.equal(res.status, 401);
    await flushAudit();
    const row = await rawPrisma.auditEvent.findFirst({ where: { action: 'auth.login' } });
    assert.equal(row.outcome, 'FAILED');
    assert.equal(row.targetLabel, admin.email);
    assert.ok(!JSON.stringify(row).includes('wrong-guess-123'));
  });
});

describe('the audit log API', () => {
  it('needs audit.view to read, and audit.export to download', async () => {
    const viewer = await adminWith(['audit.view']);
    const exporter = await adminWith(['audit.export']);
    assert.equal((await request(app).get('/api/admin/audit/events').set(bearer(viewer.token))).status, 200);
    assert.equal((await request(app).get('/api/admin/audit/events').set(bearer(exporter.token))).status, 403);
    assert.equal((await request(app).get('/api/admin/audit/events/export').set(bearer(viewer.token))).status, 403);
    assert.equal((await request(app).get('/api/admin/audit/events/export').set(bearer(exporter.token))).status, 200);
  });

  it('pages newest first, with a cursor that never repeats or skips', async () => {
    for (let i = 1; i <= 5; i += 1) await recordAudit(event({ action: `page.${i}` }));
    await flushAudit();
    const { token } = await adminWith(['audit.view']);
    const seen = [];
    let cursor = null;
    do {
      const url = `/api/admin/audit/events?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(app).get(url).set(bearer(token));
      assert.equal(res.status, 200);
      seen.push(...res.body.data.map((e) => e.action));
      cursor = res.body.nextCursor;
    } while (cursor);
    assert.deepEqual(seen.filter((a) => a.startsWith('page.')), ['page.5', 'page.4', 'page.3', 'page.2', 'page.1']);
  });

  it('refuses a malformed cursor and a bad limit', async () => {
    const { token } = await adminWith(['audit.view']);
    assert.equal((await request(app).get('/api/admin/audit/events?cursor=%%%').set(bearer(token))).status, 400);
    assert.equal((await request(app).get('/api/admin/audit/events?limit=0').set(bearer(token))).status, 400);
  });

  it('filters by action and outcome', async () => {
    await recordAudit(event({ action: 'billing.adjust', outcome: 'FAILED' }));
    await recordAudit(event({ action: 'zones.rename', outcome: 'SUCCESS' }));
    await flushAudit();
    const { token } = await adminWith(['audit.view']);
    const res = await request(app).get('/api/admin/audit/events?action=billing&outcome=FAILED').set(bearer(token));
    assert.deepEqual(res.body.data.map((e) => e.action), ['billing.adjust']);
  });

  it('shows a site its own events, and the installation administrator the installation-wide ones too', async () => {
    await runWithTenant(DEFAULT_TENANT_ID, () => recordAudit(event({ action: 'site.default', tenantId: DEFAULT_TENANT_ID })));
    await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
    await recordAudit(event({ action: 'site.b', tenantId: 'site-b' }));
    await recordAudit(event({ action: 'installation.wide', tenantId: null }));
    await flushAudit();

    const siteAdmin = await adminWith(['audit.view']);
    const siteView = await request(app).get('/api/admin/audit/events').set(bearer(siteAdmin.token));
    assert.ok(siteView.body.data.every((e) => e.tenantId === DEFAULT_TENANT_ID));

    const instance = await adminWith(['audit.view'], { instanceAdmin: true });
    const instanceView = await request(app).get('/api/admin/audit/events').set(bearer(instance.token));
    const actions = instanceView.body.data.map((e) => e.action);
    assert.ok(actions.includes('installation.wide'));
    assert.ok(actions.includes('site.default'));
    assert.ok(!actions.includes('site.b'));
  });

  it('exports CSV, quotes fields, and records the export', async () => {
    await recordAudit(event({ action: 'csv.test', actorLabel: '=HYPERLINK("x")', reason: 'a, "b"' }));
    await flushAudit();
    const { token } = await adminWith(['audit.export']);
    const res = await request(app).get('/api/admin/audit/events/export').set(bearer(token)).buffer(true).parse((r, cb) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.body, /^seq,at,actorType/);
    assert.ok(res.body.includes(`"a, ""b"""`));
    assert.ok(res.body.includes(`'=HYPERLINK`));
    await flushAudit();
    assert.ok(await rawPrisma.auditEvent.findFirst({ where: { action: 'audit.export' } }));
  });

  it('verifies the chain on request, and records the check', async () => {
    await recordAudit(event());
    await flushAudit();
    const { token } = await adminWith(['audit.view']);
    const ok = await request(app).get('/api/admin/audit/verify').set(bearer(token));
    assert.equal(ok.body.ok, true);
    const first = await rawPrisma.auditEvent.findFirst({ orderBy: { seq: 'asc' } });
    await rawPrisma.auditEvent.update({ where: { id: first.id }, data: { outcome: 'FAILED' } });
    const broken = await request(app).get('/api/admin/audit/verify').set(bearer(token));
    assert.equal(broken.body.ok, false);
  });

  it('lets only the installation administrator change the retention and IP level', async () => {
    const siteAdmin = await adminWith(['audit.view', 'system.manage']);
    assert.equal((await request(app).put('/api/admin/audit/settings').set(bearer(siteAdmin.token)).send({ retentionDays: 90 })).status, 403);

    const instance = await adminWith(['audit.view', 'system.manage'], { instanceAdmin: true });
    const got = await request(app).get('/api/admin/audit/settings').set(bearer(instance.token));
    assert.equal(got.body.retentionDays, 30);
    assert.equal(got.body.ipLogging, 'TRUNCATED');
    assert.equal(got.body.canChange, true);

    assert.equal((await request(app).put('/api/admin/audit/settings').set(bearer(instance.token)).send({ retentionDays: 45 })).status, 400);
    const saved = await request(app).put('/api/admin/audit/settings').set(bearer(instance.token)).send({ retentionDays: 90, ipLogging: 'NONE' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.retentionDays, 90);
    await flushAudit();
    const change = await rawPrisma.auditEvent.findFirst({ where: { action: 'audit.settings.update' } });
    assert.deepEqual(JSON.parse(change.changes), {
      retentionDays: { from: 30, to: 90 },
      ipLogging: { from: 'TRUNCATED', to: 'NONE' },
    });
  });
});

describe('retention', () => {
  it('deletes events older than the retention period and keeps newer ones', async () => {
    await recordAudit(event({ action: 'old' }));
    await recordAudit(event({ action: 'recent' }));
    await flushAudit();
    const longAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const old = await rawPrisma.auditEvent.findFirst({ where: { action: 'old' } });
    await rawPrisma.auditEvent.update({ where: { id: old.id }, data: { at: longAgo } });

    const deleted = await sweepAudit();
    assert.equal(deleted, 1);
    const left = await rawPrisma.auditEvent.findMany();
    assert.deepEqual(left.map((r) => r.action), ['recent']);
  });
});
