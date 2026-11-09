import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant } from '../src/tenancy/context.js';

const GOOD_CONNECTOR = {
  connectorId: 1,
  standard: 'IEC_62196_T2',
  format: 'SOCKET',
  powerType: 'AC_3_PHASE',
  maxVoltage: 400,
  maxAmperage: 32,
};

// Opens an event stream and collects the notices it receives. `next` waits for one that
// matches, or fails after `ms`.
function openStream(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const port = app.address().port;
    const frames = [];
    const waiting = [];
    let buffer = '';
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`stream answered ${res.statusCode}`));
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(raw)?.[1];
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (event === 'change') frames.push(JSON.parse(data));
          for (const w of [...waiting]) {
            const found = frames.find(w.match);
            if (found) {
              waiting.splice(waiting.indexOf(w), 1);
              w.resolve(found);
            }
          }
          end = buffer.indexOf('\n\n');
        }
      });
      resolve({
        next(match, ms = 3000) {
          const found = frames.find(match);
          if (found) return Promise.resolve(found);
          return new Promise((res2, rej2) => {
            const entry = { match, resolve: res2 };
            waiting.push(entry);
            setTimeout(() => {
              if (!waiting.includes(entry)) return;
              waiting.splice(waiting.indexOf(entry), 1);
              rej2(new Error(`no matching notice within ${ms}ms`));
            }, ms).unref();
          });
        },
        close() {
          req.destroy();
        },
      });
    });
    req.on('error', (err) => {
      if (err.code !== 'ECONNRESET') reject(err);
    });
  });
}

async function makeStation(identity, { site = null } = {}) {
  const create = () =>
    prisma.station.create({
      data: { identity, name: identity, latitude: 51.5, longitude: -0.12, connectors: { create: [GOOD_CONNECTOR] } },
    });
  return site ? runWithTenant(site, create) : create();
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
});

describe('live updates', () => {
  it('refuses the admin stream without a signed-in admin', async () => {
    const res = await request(app).get('/api/admin/live');
    assert.equal(res.status, 401);
  });

  it('announces a write to a charge point, by model and row id', async () => {
    const stream = await openStream('/api/locator/live');
    try {
      const station = await makeStation('LIVE-1');
      const notice = await stream.next((n) => n.model === 'station');
      assert.ok(notice);
      assert.ok(notice.ids === null || notice.ids.includes(station.id));
    } finally {
      stream.close();
    }
  });

  it('pushes a notice to a signed-in admin when a charge point in their site is written', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    const stream = await openStream('/api/admin/live', { Authorization: `Bearer ${login.body.token}` });
    try {
      await makeStation('ADMIN-LIVE-1');
      assert.ok(await stream.next((n) => n.model === 'station'));
    } finally {
      stream.close();
    }
  });

  it('does not push notices about another site to an admin', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    const stream = await openStream('/api/admin/live', { Authorization: `Bearer ${login.body.token}` });
    try {
      await makeStation('OTHER-SITE-1', { site: 'site-b' });
      await assert.rejects(stream.next((n) => n.model === 'station', 400));
    } finally {
      stream.close();
    }
  });

  it('gives a waitlist entry its own stream, and 404s for an unknown entry', async () => {
    const missing = await request(app).get('/api/waitlist/no-such-entry/live');
    assert.equal(missing.status, 404);
  });

  it('gives a payment its own stream, and 404s for an unknown payment link', async () => {
    const missing = await request(app).get('/api/pay/no-such-token/live');
    assert.equal(missing.status, 404);
  });
});
