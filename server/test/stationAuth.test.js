import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RPCClient } from 'ocpp-rpc';
import request from 'supertest';
import { app } from './support/testApp.js';
import { createAdmin } from './support/factories.js';
import { resetDb } from './support/db.js';
import { prisma } from '../src/db.js';
import { createCentralSystem } from '../src/ocpp/centralSystem.js';
import { hashStationKey, stationKeyMatches } from '../src/services/stationAuth.js';

describe('connection key helpers', () => {
  it('matches only the exact key', () => {
    const hash = hashStationKey('secret-key');
    assert.equal(stationKeyMatches(hash, Buffer.from('secret-key')), true);
    assert.equal(stationKeyMatches(hash, Buffer.from('secret-kex')), false);
    assert.equal(stationKeyMatches(hash, Buffer.alloc(0)), false);
    assert.equal(stationKeyMatches(hash, undefined), false);
    assert.equal(stationKeyMatches(null, Buffer.from('secret-key')), false);
  });
});

describe('charge point connection keys', () => {
  let httpServer;
  let port;
  let token;
  const clients = [];

  before(async () => {
    const central = createCentralSystem();
    httpServer = http.createServer();
    httpServer.on('upgrade', central.handleUpgrade);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  after(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(async () => {
    delete process.env.OCPP_REQUIRE_AUTH;
    await resetDb();
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    token = body.token;
  });

  const authed = (req) => req.set('Authorization', `Bearer ${token}`);

  async function addStation(identity = 'KEY-1') {
    const res = await authed(request(app).post('/api/admin/stations')).send({ identity, name: identity });
    assert.equal(res.status, 201);
    return res.body;
  }

  // Resolves to the connected client, or rejects with the handshake error.
  async function connect(identity, password) {
    const client = new RPCClient({
      endpoint: `ws://localhost:${port}/ocpp`,
      identity,
      password,
      protocols: ['ocpp1.6'],
      strictMode: true,
      reconnect: false,
    });
    try {
      await client.connect();
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
    clients.push(client);
    return client;
  }

  it('shows the key once, on create, and stores only its hash', async () => {
    const station = await addStation();
    assert.ok(station.authKey && station.authKey.length >= 32);
    assert.equal(station.hasAuthKey, true);
    const row = await prisma.station.findUnique({ where: { id: station.id } });
    assert.equal(row.authKeyHash, hashStationKey(station.authKey));
    assert.notEqual(row.authKeyHash, station.authKey);

    const again = await authed(request(app).get(`/api/admin/stations`));
    assert.equal(again.body.data[0].hasAuthKey, true);
    assert.equal(JSON.stringify(again.body).includes(station.authKey), false);
    assert.equal(JSON.stringify(again.body).includes(row.authKeyHash), false);
  });

  it('accepts the right key', async () => {
    const station = await addStation();
    const client = await connect(station.identity, station.authKey);
    assert.ok(client);
  });

  it('refuses a missing or wrong key', async () => {
    const station = await addStation();
    await assert.rejects(connect(station.identity, undefined), /Unauthorized/);
    await assert.rejects(connect(station.identity, 'not-the-key'), /Unauthorized/);
  });

  it('gives an unknown identity the same answer as a wrong key', async () => {
    const station = await addStation();
    const wrong = await connect(station.identity, 'nope').catch((e) => e);
    const unknown = await connect('NO-SUCH-CP', 'nope').catch((e) => e);
    assert.equal(wrong.message, unknown.message);
  });

  it('lets a charge point without a key connect, unless keys are required', async () => {
    await prisma.station.create({ data: { identity: 'OLD-1', name: 'Old' } });
    assert.ok(await connect('OLD-1', undefined));
    process.env.OCPP_REQUIRE_AUTH = '1';
    await assert.rejects(connect('OLD-1', undefined), /Unauthorized/);
  });

  it('a new key replaces the old one and disconnects the charge point', async () => {
    const station = await addStation();
    const client = await connect(station.identity, station.authKey);
    const closed = new Promise((resolve) => client.once('close', resolve));

    const res = await authed(request(app).post(`/api/admin/stations/${station.id}/auth-key`));
    assert.equal(res.status, 200);
    assert.ok(res.body.authKey && res.body.authKey !== station.authKey);
    await closed;

    await assert.rejects(connect(station.identity, station.authKey), /Unauthorized/);
    assert.ok(await connect(station.identity, res.body.authKey));
  });

  it('gives a charge point that had no key its first key', async () => {
    const old = await prisma.station.create({ data: { identity: 'OLD-2', name: 'Old' } });
    const res = await authed(request(app).post(`/api/admin/stations/${old.id}/auth-key`));
    assert.equal(res.status, 200);
    await assert.rejects(connect('OLD-2', undefined), /Unauthorized/);
    assert.ok(await connect('OLD-2', res.body.authKey));
  });

  it('needs the manage permission and a real station', async () => {
    const station = await addStation();
    const anon = await request(app).post(`/api/admin/stations/${station.id}/auth-key`);
    assert.equal(anon.status, 401);
    const missing = await authed(request(app).post('/api/admin/stations/nope/auth-key'));
    assert.equal(missing.status, 404);
  });
});
