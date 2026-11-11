import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin, totpCode } from './support/factories.js';
import { rawPrisma, prisma } from '../src/db.js';
import { flushAudit } from '../src/audit/record.js';
import { consume, peek, record, resetLimiter, sweep } from '../src/rateLimit/limiter.js';
import { RULE_DEFS, clearRateLimitCache, validateChanges } from '../src/rateLimit/rules.js';
import { addressKey } from '../src/rateLimit/middleware.js';
import { trustProxySetting } from '../src/app.js';

// The rest of the suite runs with limits off (see env.setup.js). These tests turn them on.
let savedFlag;
before(() => {
  savedFlag = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
});
after(() => {
  if (savedFlag !== undefined) process.env.RATE_LIMIT_DISABLED = savedFlag;
});

const opts = (limit, windowMs = 1000) => ({ limit, windowMs });

describe('limiter', () => {
  beforeEach(resetLimiter);

  it('allows up to the limit, then refuses with a wait', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i += 1) assert.equal(consume('r', 'k', opts(3), t).allowed, true);
    const blocked = consume('r', 'k', opts(3), t);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 1000);
    assert.equal(blocked.remaining, 0);
  });

  it('keeps keys and rules apart', () => {
    consume('r', 'a', opts(1), 0);
    assert.equal(consume('r', 'a', opts(1), 0).allowed, false);
    assert.equal(consume('r', 'b', opts(1), 0).allowed, true);
    assert.equal(consume('other', 'a', opts(1), 0).allowed, true);
  });

  it('lets requests through again once the window has passed', () => {
    consume('r', 'k', opts(2), 0);
    consume('r', 'k', opts(2), 0);
    assert.equal(consume('r', 'k', opts(2), 500).allowed, false);
    assert.equal(consume('r', 'k', opts(2), 2500).allowed, true);
  });

  it('counts the previous window less as time passes (no burst at the edge)', () => {
    consume('r', 'k', opts(5), 0);
    for (let i = 0; i < 4; i += 1) consume('r', 'k', opts(5), 900);
    // Just after the boundary the earlier window still weighs almost fully: one more fits, not five.
    assert.equal(consume('r', 'k', opts(5), 1010).allowed, true);
    assert.equal(consume('r', 'k', opts(5), 1011).allowed, false);
    // Late in the next window it has mostly faded.
    assert.equal(consume('r', 'k', opts(5), 1990).allowed, true);
  });

  it('does not count a refused request, so a blocked key recovers on time', () => {
    consume('r', 'k', opts(1), 0);
    for (let i = 0; i < 50; i += 1) consume('r', 'k', opts(1), 100);
    assert.equal(consume('r', 'k', opts(1), 2100).allowed, true);
  });

  it('peek does not count, and record counts even past the limit', () => {
    assert.equal(peek('r', 'k', opts(2), 0).allowed, true);
    assert.equal(peek('r', 'k', opts(2), 0).allowed, true);
    record('r', 'k', opts(2), 0);
    record('r', 'k', opts(2), 0);
    assert.equal(peek('r', 'k', opts(2), 0).allowed, false);
  });

  it('forgets quiet keys', () => {
    consume('r', 'k', opts(1), 0);
    sweep(10_000);
    assert.equal(consume('r', 'k', opts(1), 10_000).allowed, true);
  });
});

describe('address keys', () => {
  const key = (ip) => addressKey({ ip, headers: {} });
  it('treats an IPv4-mapped address as IPv4', () => assert.equal(key('::ffff:203.0.113.5'), '203.0.113.5'));
  it('groups IPv6 addresses by their first 64 bits', () => {
    assert.equal(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key('2001:DB8:1:2::1'));
    assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'));
  });
});

describe('trust proxy setting', () => {
  it('reads a hop count, a boolean or an address list', () => {
    assert.equal(trustProxySetting(undefined), undefined);
    assert.equal(trustProxySetting(''), undefined);
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
  });
});

describe('validating changes', () => {
  it('accepts good changes', () => {
    const r = validateChanges({ 'login.ip': { limit: 10, windowSeconds: 60, enabled: false } });
    assert.deepEqual(r.value, { 'login.ip': { limit: 10, windowSeconds: 60, enabled: false } });
  });
  it('refuses bad ones', () => {
    for (const bad of [
      { nope: { limit: 5 } },
      { 'login.ip': { limit: 0 } },
      { 'login.ip': { limit: 2 } }, // under the rule's floor
      { 'login.ip': { limit: 1.5 } },
      { 'login.ip': { limit: '10' } },
      { 'login.ip': { windowSeconds: 0 } },
      { 'login.ip': { windowSeconds: 999999 } },
      { 'login.ip': { enabled: 'yes' } },
      { 'login.ip': { colour: 'red' } },
      { 'liveStreams.ip': { windowSeconds: 60 } },
      { 'login.account': { limit: 1 } },
      [],
      null,
    ]) {
      assert.ok(validateChanges(bad).error, JSON.stringify(bad));
    }
  });
  it('has defaults that respect their own floors', () => {
    for (const [name, def] of Object.entries(RULE_DEFS)) assert.ok(def.limit >= def.minLimit, name);
  });
});

describe('rate limits over HTTP', () => {
  let token;
  let operator;

  async function signIn(email, password = 'CorrectHorse1!') {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return res;
  }

  beforeEach(async () => {
    await resetDb();
    operator = await createAdmin({ password: 'CorrectHorse1!' });
    await rawPrisma.admin.update({ where: { id: operator.id }, data: { instanceAdmin: true } });
    token = (await signIn(operator.email)).body.token;
    assert.ok(token);
    // The sign-in above counted. Start each test with empty counters.
    resetLimiter();
  });

  const authed = (req) => req.set('Authorization', `Bearer ${token}`);
  const setRules = (rules) => authed(request(app).put('/api/admin/rate-limits')).send({ rules });

  describe('the settings API', () => {
    it('lists every rule with its defaults', async () => {
      const res = await authed(request(app).get('/api/admin/rate-limits'));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.rules.map((r) => r.name), Object.keys(RULE_DEFS));
      const login = res.body.rules.find((r) => r.name === 'login.ip');
      assert.equal(login.limit, 20);
      assert.equal(login.enabled, true);
      assert.equal(login.changed, false);
    });

    it('requires a sign-in, the permission, and the installation administrator', async () => {
      assert.equal((await request(app).get('/api/admin/rate-limits')).status, 401);

      await prisma.customRole.create({ data: { name: 'Ops', permissions: JSON.stringify(['system.manage']) } });
      const ops = await createAdmin({ password: 'CorrectHorse1!' });
      await rawPrisma.admin.update({ where: { id: ops.id }, data: { role: 'Ops', instanceAdmin: true } });
      const opsToken = (await signIn(ops.email)).body.token;
      const noPermission = await request(app).get('/api/admin/rate-limits').set('Authorization', `Bearer ${opsToken}`);
      assert.equal(noPermission.status, 403);

      await prisma.customRole.create({ data: { name: 'Limits', permissions: JSON.stringify(['rateLimits.manage']) } });
      const siteAdmin = await createAdmin({ password: 'CorrectHorse1!' });
      await rawPrisma.admin.update({ where: { id: siteAdmin.id }, data: { role: 'Limits', instanceAdmin: false } });
      const siteToken = (await signIn(siteAdmin.email)).body.token;
      const notInstance = await request(app).put('/api/admin/rate-limits').set('Authorization', `Bearer ${siteToken}`).send({ rules: { 'login.ip': { limit: 50 } } });
      assert.equal(notInstance.status, 403);
    });

    it('saves a change, keeps it across a reload, and records it in the audit log', async () => {
      const res = await setRules({ 'login.ip': { limit: 7, windowSeconds: 120 } });
      assert.equal(res.status, 200);
      const rule = res.body.rules.find((r) => r.name === 'login.ip');
      assert.equal(rule.limit, 7);
      assert.equal(rule.windowSeconds, 120);
      assert.equal(rule.changed, true);

      clearRateLimitCache(); // as after a restart
      const again = await authed(request(app).get('/api/admin/rate-limits'));
      // The cache is empty until a limited request loads it, so make one.
      await request(app).get('/api/health');
      const reloaded = await authed(request(app).get('/api/admin/rate-limits'));
      assert.equal(reloaded.body.rules.find((r) => r.name === 'login.ip').limit, 7);
      assert.ok(again.status === 200);

      await flushAudit();
      const event = await rawPrisma.auditEvent.findFirst({ where: { action: 'admin.rate-limits.update', targetType: 'rate_limits' } });
      assert.ok(event);
      assert.match(event.changes, /login\.ip\.limit/);
    });

    it('stores only what differs from the defaults', async () => {
      await setRules({ 'login.ip': { limit: 7 } });
      await setRules({ 'login.ip': { limit: 20 } }); // back to the default
      const row = await rawPrisma.rateLimitSettings.findUnique({ where: { id: 'singleton' } });
      assert.equal(row.rules, '{}');
    });

    it('rejects bad input and empty changes', async () => {
      assert.equal((await setRules({ 'login.ip': { limit: -1 } })).status, 400);
      assert.equal((await setRules({ nope: { limit: 50 } })).status, 400);
      assert.equal((await setRules({})).status, 400);
    });

    it('resets everything to the defaults', async () => {
      await setRules({ 'login.ip': { limit: 7 }, 'general.ip': { enabled: false } });
      const res = await authed(request(app).delete('/api/admin/rate-limits'));
      assert.equal(res.status, 200);
      assert.ok(res.body.rules.every((r) => !r.changed && r.enabled));
    });
  });

  describe('sign-in', () => {
    it('refuses an address after too many attempts, with Retry-After', async () => {
      await setRules({ 'login.ip': { limit: 5 } });
      resetLimiter();
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await signIn(`nobody${i}@example.com`, 'x')).status, 401);
      }
      const res = await signIn('nobody9@example.com', 'x');
      assert.equal(res.status, 429);
      assert.equal(res.body.code, 'RATE_LIMITED');
      assert.ok(Number(res.headers['retry-after']) >= 1);
      assert.equal(res.headers['ratelimit-remaining'], '0');

      await flushAudit();
      const event = await rawPrisma.auditEvent.findFirst({ where: { action: 'rateLimit.exceeded' } });
      assert.equal(event.targetLabel, 'login.ip');
      assert.equal(event.outcome, 'DENIED');
    });

    it('locks one account after wrong passwords, even for the right password, and spares others', async () => {
      await setRules({ 'login.ip': { limit: 1000 }, 'login.account': { limit: 3 } });
      const victim = await createAdmin({ password: 'CorrectHorse1!' });
      const other = await createAdmin({ password: 'CorrectHorse1!' });
      resetLimiter();
      for (let i = 0; i < 3; i += 1) assert.equal((await signIn(victim.email, 'wrong')).status, 401);
      assert.equal((await signIn(victim.email, 'CorrectHorse1!')).status, 429);
      assert.equal((await signIn(victim.email.toUpperCase(), 'CorrectHorse1!')).status, 429);
      assert.equal((await signIn(other.email, 'CorrectHorse1!')).status, 200);
    });

    it('does not count successful sign-ins against the account', async () => {
      await setRules({ 'login.ip': { limit: 1000 }, 'login.account': { limit: 3 } });
      resetLimiter();
      for (let i = 0; i < 10; i += 1) assert.equal((await signIn(operator.email)).status, 200);
    });

    it('limits wrong two-factor codes per account', async () => {
      await setRules({ 'mfa.ip': { limit: 1000 }, 'mfa.account': { limit: 3 } });
      const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
      resetLimiter();
      const { body } = await signIn(admin.email);
      const verify = (code) => request(app).post('/api/auth/mfa/verify').send({ preAuthToken: body.preAuthToken, code });
      for (let i = 0; i < 3; i += 1) assert.equal((await verify('000000')).status, 401);
      // Locked: not even the right code works until the window passes.
      assert.equal((await verify(totpCode(admin.mfaSecret))).status, 429);
    });

    it('cannot lock an account out with a made-up pre-auth token', async () => {
      await setRules({ 'mfa.ip': { limit: 1000 }, 'mfa.account': { limit: 3 } });
      const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
      resetLimiter();
      for (let i = 0; i < 6; i += 1) {
        const res = await request(app).post('/api/auth/mfa/verify').send({ preAuthToken: `x.${admin.id}.y`, code: '000000' });
        assert.equal(res.status, 401);
      }
      const { body } = await signIn(admin.email);
      const ok = await request(app).post('/api/auth/mfa/verify').send({ preAuthToken: body.preAuthToken, code: totpCode(admin.mfaSecret) });
      assert.equal(ok.status, 200);
    });

    it('limits e-mailed code requests per address', async () => {
      await setRules({ 'signInCode.ip': { limit: 5 } });
      resetLimiter();
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post('/api/auth/code/request').send({ email: 'not an email' });
        assert.equal(res.status, 400);
      }
      assert.equal((await request(app).post('/api/auth/code/request').send({ email: 'a@example.com' })).status, 429);
    });
  });

  describe('other rules', () => {
    it('limits driver actions that change something, but not reads', async () => {
      await setRules({ 'publicWrite.ip': { limit: 5 } });
      resetLimiter();
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post('/api/waitlist/none/start-charging');
        assert.notEqual(res.status, 429);
      }
      assert.equal((await request(app).post('/api/waitlist/none/start-charging')).status, 429);
      assert.notEqual((await request(app).get('/api/settings')).status, 429);
    });

    it('applies the all-requests limit but exempts the health check and payment webhooks', async () => {
      await setRules({ 'general.ip': { limit: 30 } });
      resetLimiter();
      for (let i = 0; i < 40; i += 1) assert.equal((await request(app).get('/api/health')).status, 200);
      for (let i = 0; i < 40; i += 1) {
        const res = await request(app).post('/api/payments/stripe/webhook').set('Content-Type', 'application/json').send('{}');
        assert.notEqual(res.status, 429);
      }
      for (let i = 0; i < 30; i += 1) await request(app).get('/api/settings');
      assert.equal((await request(app).get('/api/settings')).status, 429);
    });

    it('limits admin requests per session, so one token cannot flood', async () => {
      await setRules({ 'authenticated.session': { limit: 30 } });
      resetLimiter();
      let last;
      for (let i = 0; i < 31; i += 1) last = await authed(request(app).get('/api/auth/me'));
      // /api/auth/me is not under /api/admin, so it is not limited; an admin route is.
      assert.notEqual(last.status, 429);
      for (let i = 0; i < 30; i += 1) await authed(request(app).get('/api/admin/stations'));
      assert.equal((await authed(request(app).get('/api/admin/stations'))).status, 429);
    });

    it('does nothing for a rule that is turned off', async () => {
      await setRules({ 'login.ip': { limit: 5, enabled: false } });
      resetLimiter();
      for (let i = 0; i < 12; i += 1) assert.equal((await signIn(`x${i}@example.com`, 'x')).status, 401);
    });

    it('caps open live-update streams per address', async () => {
      await setRules({ 'liveStreams.ip': { limit: 1 } });
      const port = app.address().port;
      const open = () =>
        new Promise((resolve, reject) => {
          const req = http.get(
            { port, host: '127.0.0.1', path: '/api/admin/live', headers: { Authorization: `Bearer ${token}` } },
            (res) => resolve({ res, req }),
          );
          req.on('error', reject);
        });
      const first = await open();
      assert.equal(first.res.statusCode, 200);
      const second = await open();
      assert.equal(second.res.statusCode, 429);
      second.res.resume();

      first.req.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const third = await open();
      assert.equal(third.res.statusCode, 200);
      third.req.destroy();
    });
  });
});
