import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { rawPrisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import {
  effectivePlateRegions,
  parsePlateRegionConfig,
  validatePlateRegionConfig,
} from '../src/services/plateRegions.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

async function createStation(identity = 'CP-PLATE') {
  const res = await authed(request(app).post('/api/admin/stations')).send({ identity, name: 'Garage P', connectorCount: 1 });
  return res.body;
}

describe('plate region lists', () => {
  it('offers US states, Canadian provinces and EU countries by default', () => {
    const regions = effectivePlateRegions(parsePlateRegionConfig(null));
    const codes = regions.map((r) => r.code);
    assert.ok(codes.includes('US-CA'));
    assert.ok(codes.includes('CA-ON'));
    assert.ok(codes.includes('DE'));
    assert.equal(new Set(codes).size, codes.length, 'codes are unique');
  });

  it('builds the list from the chosen sets, plus custom entries', () => {
    const regions = effectivePlateRegions({ sets: ['CA'], custom: [{ code: 'MX-CMX', name: 'Mexico City' }] });
    assert.ok(regions.every((r) => r.code.startsWith('CA-') || r.code === 'MX-CMX'));
    assert.equal(regions.find((r) => r.code === 'MX-CMX').group, 'Custom');
  });

  it('rejects a duplicate custom code and an unknown set', () => {
    assert.ok(validatePlateRegionConfig({ sets: ['US'], custom: [{ code: 'US-CA', name: 'Dup' }] }).error);
    assert.ok(validatePlateRegionConfig({ sets: ['XX'], custom: [] }).error);
  });

  it('rejects a custom code with characters a URL or a form should not carry', () => {
    assert.ok(validatePlateRegionConfig({ sets: ['US'], custom: [{ code: 'A B', name: 'Bad' }] }).error);
  });

  it('refuses to save an empty list', () => {
    assert.ok(validatePlateRegionConfig({ sets: [], custom: [] }).error);
  });
});

describe('admin settings: plate regions and font', () => {
  it('returns the offered regions on the public settings endpoint', async () => {
    const res = await request(app).get('/api/settings');
    assert.equal(res.status, 200);
    assert.ok(res.body.plateRegions.some((r) => r.code === 'US-CA'));
    // 51 US entries (50 states and DC), 13 Canadian provinces and territories, 27 EU countries.
    assert.equal(res.body.plateRegionCatalog.length, 91);
    assert.deepEqual(
      res.body.plateRegionSets.map((s) => s.id).sort(),
      ['CA', 'EU', 'US'],
    );
  });

  it('saves a chosen list and default place', async () => {
    const res = await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['US'], custom: [{ code: 'MX-CMX', name: 'Mexico City' }] },
      defaultPlateRegion: 'US-CA',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.defaultPlateRegion, 'US-CA');
    assert.ok(res.body.plateRegions.some((r) => r.code === 'MX-CMX'));
    assert.ok(!res.body.plateRegions.some((r) => r.code === 'DE'));
  });

  it('refuses a default place the list does not offer', async () => {
    const res = await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['US'], custom: [] },
      defaultPlateRegion: 'DE',
    });
    assert.equal(res.status, 400);
  });

  it('clears the default place when its region is removed from the list', async () => {
    await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['US'], custom: [] },
      defaultPlateRegion: 'US-CA',
    });
    const res = await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['EU'], custom: [] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.defaultPlateRegion, null);
  });

  it('refuses a font name that could break out of a URL or CSS', async () => {
    const res = await authed(request(app).put('/api/admin/settings')).send({
      fontFamily: 'Inter; background: red',
    });
    assert.equal(res.status, 400);
  });

  it('accepts a Google Font name and a font stack with a generic fallback', async () => {
    const plain = await authed(request(app).put('/api/admin/settings')).send({ fontFamily: 'Source Sans 3' });
    assert.equal(plain.status, 200);
    const stack = await authed(request(app).put('/api/admin/settings')).send({ fontFamily: 'Merriweather, serif' });
    assert.equal(stack.status, 200);
    assert.equal(stack.body.fontFamily, 'Merriweather, serif');
  });
});

describe('joining with a plate region', () => {
  it('stores the chosen region with the plate', async () => {
    await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['US'], custom: [] },
      defaultPlateRegion: 'US-CA',
    });
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-NY' });
    assert.equal(join.status, 201);
    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.body.plateRegion, 'US-NY');
  });

  it('uses the default region when the driver sends none', async () => {
    await authed(request(app).put('/api/admin/settings')).send({
      plateRegionConfig: { sets: ['US'], custom: [] },
      defaultPlateRegion: 'US-CA',
    });
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });
    assert.equal(join.status, 201);
    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.body.plateRegion, 'US-CA');
  });

  it('refuses a region the waitlist does not offer', async () => {
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'ZZ-99' });
    assert.equal(res.status, 400);
  });

  it('stores no region when the driver gave no plate', async () => {
    await authed(request(app).put('/api/admin/settings')).send({ identifierMode: 'BOTH' });
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', plateRegion: 'US-CA', parkingPermit: 'P-1' });
    assert.equal(join.status, 201);
    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.body.plateRegion, null);
  });
});

describe('POST /api/admin/stations/test-connection/:step', () => {
  const step = (name, body) => authed(request(app).post(`/api/admin/stations/test-connection/${name}`)).send(body);

  it('requires a charge point identity', async () => {
    const res = await step('connected', {});
    assert.equal(res.status, 400);
  });

  it('rejects an unknown step', async () => {
    const res = await step('reboot', { identity: 'CP-OFFLINE' });
    assert.equal(res.status, 404);
  });

  it('reports 404 for a charge point that is not in this site', async () => {
    const res = await step('connected', { identity: 'NOPE' });
    assert.equal(res.status, 404);
  });

  it('fails the connected step for a charge point that has not connected', async () => {
    await createStation('CP-OFFLINE');
    const res = await step('connected', { identity: 'CP-OFFLINE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
  });

  it('fails the later steps when the charge point is not connected', async () => {
    await createStation('CP-OFFLINE');
    for (const name of ['configuration', 'deactivate', 'activate']) {
      const res = await step(name, { identity: 'CP-OFFLINE' });
      assert.equal(res.body.ok, false, name);
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/admin/stations/test-connection/connected').send({ identity: 'CP-OFFLINE' });
    assert.equal(res.status, 401);
  });

  it('takes a connected charge point out of service and back, reading its status reports', async () => {
    const station = await createStation('CP-TEST');
    // Start in service, so the deactivation check has a real change to see.
    await rawPrisma.connector.updateMany({ where: { stationId: station.id }, data: { status: 'Available' } });
    // A fake charge point: it answers configuration, and reports its status after each change.
    // Reports are written one after another, as a charge point sends them.
    let reports = Promise.resolve();
    const fake = {
      async call(method, params) {
        if (method === 'GetConfiguration') return { configurationKey: [{ key: 'HeartbeatInterval', value: '300' }] };
        if (method === 'ChangeAvailability') {
          const status = params.type === 'Inoperative' ? 'Unavailable' : 'Available';
          reports = reports
            .then(() => new Promise((resolve) => setTimeout(resolve, 50)))
            .then(() => rawPrisma.connector.updateMany({ where: { stationId: station.id }, data: { status } }));
          return { status: 'Accepted' };
        }
        throw new Error(`unexpected ${method}`);
      },
    };
    registry.add('CP-TEST', fake);
    try {
      const since = new Date(Date.now() - 1000).toISOString();
      for (const name of ['connected', 'configuration', 'deactivate', 'deactivated', 'activate', 'activated']) {
        const res = await step(name, { identity: 'CP-TEST', since });
        assert.equal(res.body.ok, true, `${name}: ${res.body.message}`);
      }
    } finally {
      registry.remove('CP-TEST');
    }
  });

  it('refuses to take a charge point out of service during a session', async () => {
    const station = await createStation('CP-BUSY');
    await rawPrisma.transaction.create({
      data: {
        tenantId: 'default',
        stationId: station.id,
        connectorId: 1,
        idTag: 'busy-tag',
        ocppTransactionId: 9001,
      },
    });
    registry.add('CP-BUSY', { call: async () => ({ status: 'Accepted' }) });
    try {
      const res = await step('deactivate', { identity: 'CP-BUSY' });
      assert.equal(res.body.ok, false);
      assert.match(res.body.message, /session is in progress/);
    } finally {
      registry.remove('CP-BUSY');
    }
  });
});
