import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { readLimit, decodeCursor, encodeCursor, MAX_LIMIT, DEFAULT_LIMIT } from '../src/pagination.js';
import { flushAudit } from '../src/audit/record.js';

const PASSWORD = 'Password123!';
let token;

beforeEach(async () => {
  await flushAudit();
  await resetDb();
  const admin = await createAdmin({ password: PASSWORD });
  const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  token = res.body.token;
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

// Walks every page, returning the names in the order they came.
async function everyName(url) {
  const names = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await auth(request(app).get(`${url}${sep}limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    names.push(...res.body.data.map((s) => s.name));
    cursor = res.body.nextCursor;
    if (!cursor) return names;
  }
  throw new Error('pagination did not end');
}

describe('cursor helpers', () => {
  it('reads limits, capping large ones and refusing bad ones', () => {
    assert.equal(readLimit({}).value, DEFAULT_LIMIT);
    assert.equal(readLimit({ limit: '5' }).value, 5);
    assert.equal(readLimit({ limit: '9999' }).value, MAX_LIMIT);
    assert.ok(readLimit({ limit: 'abc' }).error);
    assert.ok(readLimit({ limit: '1.5' }).error);
  });

  it('round-trips a cursor and rejects anything else', () => {
    assert.deepEqual(decodeCursor(encodeCursor({ v: 'Bay 2', i: 'abc' })), { v: 'Bay 2', i: 'abc' });
    assert.equal(decodeCursor('not base64 json'), null);
    assert.equal(decodeCursor(encodeCursor([1, 2])), null);
  });
});

describe('list pages', () => {
  it('walks every station, in name order, with no repeats or gaps', async () => {
    for (const name of ['Bay 4', 'Bay 1', 'Bay 5', 'Bay 2', 'Bay 3']) {
      await prisma.station.create({ data: { identity: `CP-${name}`, name } });
    }
    assert.deepEqual(await everyName('/api/admin/stations'), ['Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5']);
  });

  it('does not repeat or skip rows added between pages', async () => {
    for (const name of ['Bay 1', 'Bay 3', 'Bay 5']) {
      await prisma.station.create({ data: { identity: `CP-${name}`, name } });
    }
    const first = await auth(request(app).get('/api/admin/stations?limit=2'));
    assert.deepEqual(first.body.data.map((s) => s.name), ['Bay 1', 'Bay 3']);
    // A row added before the cursor position does not shift the rest of the list.
    await prisma.station.create({ data: { identity: 'CP-Bay 2', name: 'Bay 2' } });
    await prisma.station.create({ data: { identity: 'CP-Bay 6', name: 'Bay 6' } });
    const second = await auth(request(app).get(`/api/admin/stations?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`));
    assert.deepEqual(second.body.data.map((s) => s.name), ['Bay 5', 'Bay 6']);
    assert.equal(second.body.nextCursor, null);
  });

  it('pages zones, users, and complaints in the same way', async () => {
    for (const name of ['Garage C', 'Garage A', 'Garage B']) await prisma.zone.create({ data: { name } });
    assert.deepEqual(await everyName('/api/admin/zones'), ['Garage A', 'Garage B', 'Garage C']);

    await createAdmin({});
    const users = await auth(request(app).get('/api/admin/users?limit=1'));
    assert.equal(users.body.data.length, 1);
    assert.ok(users.body.nextCursor);
  });

  it('refuses a malformed cursor', async () => {
    const res = await auth(request(app).get('/api/admin/stations?cursor=%%%'));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /cursor/);
  });

  it('pages the public API the same way', async () => {
    const key = await (async () => {
      const { issueApiKey } = await import('../src/services/serviceAccountService.js');
      const { runWithTenant, DEFAULT_TENANT_ID } = await import('../src/tenancy/context.js');
      return runWithTenant(DEFAULT_TENANT_ID, async () => {
        const account = await prisma.serviceAccount.create({
          data: { name: 'pager', permissions: JSON.stringify(['api.stations.read', 'api.zones.read']) },
        });
        return (await issueApiKey(account.id, { name: 'pager', expiresAt: null })).plainKey;
      });
    })();
    for (const name of ['Bay 2', 'Bay 1', 'Bay 3']) await prisma.station.create({ data: { identity: `CP-${name}`, name } });
    const seen = [];
    let cursor = null;
    do {
      const res = await request(app).get(`/api/v1/stations?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).set('Authorization', `Bearer ${key}`);
      assert.equal(res.status, 200);
      seen.push(...res.body.data.map((s) => s.name));
      cursor = res.body.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, ['Bay 1', 'Bay 2', 'Bay 3']);
    assert.equal(await rawPrisma.station.count(), 3);
  });
});
