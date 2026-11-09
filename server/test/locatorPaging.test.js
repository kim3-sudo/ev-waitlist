import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
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

async function makeStation(identity, { site = null, name = identity } = {}) {
  const create = () =>
    prisma.station.create({
      data: { identity, name, latitude: 51.5, longitude: -0.12, connectors: { create: [GOOD_CONNECTOR] } },
    });
  return site ? runWithTenant(site, create) : create();
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
});

describe('locator paging', () => {
  it('returns one page of charge points by default, with the total and whether more follow', async () => {
    for (let i = 0; i < 30; i += 1) await makeStation(`P-${String(i).padStart(2, '0')}`);
    const first = await request(app).get('/api/locator/stations');
    assert.equal(first.status, 200);
    assert.equal(first.body.stations.length, 25);
    assert.equal(first.body.count, 30);
    assert.equal(first.body.hasMore, true);

    const rest = await request(app).get('/api/locator/stations?offset=25');
    assert.equal(rest.body.stations.length, 5);
    assert.equal(rest.body.hasMore, false);
  });

  it('pages do not overlap and together hold every match', async () => {
    for (let i = 0; i < 7; i += 1) await makeStation(`Q-${i}`);
    const seen = [];
    for (let offset = 0; ; offset += 3) {
      const res = await request(app).get(`/api/locator/stations?limit=3&offset=${offset}`);
      seen.push(...res.body.stations.map((s) => s.id));
      if (!res.body.hasMore) break;
    }
    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7);
  });

  it('caps the page size, and ignores a bad limit or offset', async () => {
    await makeStation('ONLY-1');
    const capped = await request(app).get('/api/locator/stations?limit=100000');
    assert.equal(capped.body.limit, 500);
    const bad = await request(app).get('/api/locator/stations?limit=abc&offset=-4');
    assert.equal(bad.body.limit, 25);
    assert.equal(bad.body.offset, 0);
    assert.equal(bad.body.stations.length, 1);
  });

  it('filters are applied before the page is cut, so the count is for the whole match', async () => {
    for (let i = 0; i < 4; i += 1) await makeStation(`N-${i}`, { name: `Named ${i}` });
    await makeStation('OTHER-1', { name: 'Elsewhere' });
    const res = await request(app).get('/api/locator/stations?q=named&limit=2');
    assert.equal(res.body.count, 4);
    assert.equal(res.body.stations.length, 2);
    assert.equal(res.body.hasMore, true);
  });

  it('pages sites, and gives the charge point count across all matching sites', async () => {
    await makeStation('A-1');
    await makeStation('A-2');
    await makeStation('B-1', { site: 'site-b' });
    const res = await request(app).get('/api/locator/sites?limit=1');
    assert.equal(res.body.sites.length, 1);
    assert.equal(res.body.total, 2);
    assert.equal(res.body.count, 3);
    assert.equal(res.body.hasMore, true);

    const second = await request(app).get('/api/locator/sites?limit=1&offset=1');
    assert.equal(second.body.sites.length, 1);
    assert.notEqual(second.body.sites[0].id, res.body.sites[0].id);
    assert.equal(second.body.hasMore, false);
  });

  it('the map can ask for the charge points in a box, with a larger page', async () => {
    await makeStation('IN-1');
    const res = await request(app).get('/api/locator/stations?bbox=-1,51,0,52&limit=500');
    assert.equal(res.body.stations.length, 1);
    const away = await request(app).get('/api/locator/stations?bbox=10,10,11,11&limit=500');
    assert.equal(away.body.count, 0);
    assert.equal(away.body.hasMore, false);
  });
});
