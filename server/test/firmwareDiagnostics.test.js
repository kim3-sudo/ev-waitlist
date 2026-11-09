import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import { config } from '../src/config.js';
import { hashUploadToken } from '../src/services/fileStore.js';
import { markLatestDiagnosticsFailed } from '../src/services/diagnosticsLogs.js';

const PASSWORD = 'CorrectHorse1!';
const FILES_ROOT = path.join(config.dataDir, 'files');
const FIRMWARE_BYTES = Buffer.from('FIRMWARE-IMAGE-v2.1.0-payload');
const LOG_BYTES = Buffer.from('2026-11-09 diagnostics line\n');

let token;
let viewerToken;
let station;

beforeEach(async () => {
  await resetDb();
  await createAdmin({ email: 'ops@example.test', password: PASSWORD });
  const viewer = await createAdmin({ email: 'viewer@example.test', password: PASSWORD });
  await prisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
  token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
  viewerToken = (await request(app).post('/api/auth/login').send({ email: 'viewer@example.test', password: PASSWORD })).body.token;
  station = await prisma.station.create({ data: { identity: 'CP-FW', name: 'Depot 1' } });
});

afterEach(() => {
  registry.remove('CP-FW');
  fs.rmSync(FILES_ROOT, { recursive: true, force: true });
});

const authed = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

// A fake charge point connection that records each call and answers with the given reply.
function connectFake(replies = {}) {
  const calls = [];
  const client = {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      return reply ?? {};
    },
  };
  registry.add('CP-FW', client);
  return client;
}

async function uploadFirmware(query = {}, body = FIRMWARE_BYTES, fileName = 'v2.1.0.bin') {
  return authed(request(app).post('/api/admin/firmware'))
    .query({ name: 'Depot build', version: '2.1.0', ...query })
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', fileName)
    .send(body);
}

// The path part of a link the charge point was given, so the test can call it through the app.
const pathOf = (url) => new URL(url).pathname;

describe('station feature flags', () => {
  it('are off by default and can be turned on and off by an admin', async () => {
    const created = await prisma.station.findUnique({ where: { id: station.id } });
    assert.equal(created.firmwareUpdateEnabled, false);
    assert.equal(created.smartChargingEnabled, false);
    assert.equal(created.localListEnabled, false);

    const res = await authed(request(app).put(`/api/admin/stations/${station.id}`))
      .send({ firmwareUpdateEnabled: true, smartChargingEnabled: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.firmwareUpdateEnabled, true);
    assert.equal(res.body.smartChargingEnabled, true);
    assert.equal(res.body.localListEnabled, false);
  });

  it('refuse values that are not true or false', async () => {
    const res = await authed(request(app).put(`/api/admin/stations/${station.id}`))
      .send({ localListEnabled: 'yes' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /localListEnabled must be true or false/);
  });

  it('block firmware and diagnostics commands while the feature is off, and send nothing', async () => {
    const fake = connectFake();
    const upload = await uploadFirmware();
    const fw = await authed(request(app).post(`/api/admin/station-commands/${station.id}/update-firmware`))
      .send({ firmwarePackageId: upload.body.id });
    assert.equal(fw.status, 409);
    const diag = await authed(request(app).post(`/api/admin/station-commands/${station.id}/get-diagnostics`)).send({});
    assert.equal(diag.status, 409);
    assert.equal(fake.calls.length, 0);
  });
});

describe('firmware packages on local disk', () => {
  it('stores the upload, records its size and checksum, and returns the file on download', async () => {
    const res = await uploadFirmware();
    assert.equal(res.status, 201);
    assert.equal(res.body.version, '2.1.0');
    assert.equal(res.body.sizeBytes, FIRMWARE_BYTES.length);
    assert.match(res.body.sha256, /^[0-9a-f]{64}$/);
    assert.equal(res.body.fileName, 'v2.1.0.bin');

    const download = await authed(request(app).get(`/api/admin/firmware/${res.body.id}/download`)).buffer(true).parse(binaryParser);
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, FIRMWARE_BYTES);
  });

  it('keeps only a safe base name from the client file name', async () => {
    const res = await uploadFirmware({}, FIRMWARE_BYTES, '../../etc/passwd');
    assert.equal(res.status, 201);
    assert.equal(res.body.fileName, 'passwd');
  });

  it('needs a name and version and a non-empty body', async () => {
    const noName = await authed(request(app).post('/api/admin/firmware'))
      .query({ version: '1' }).set('Content-Type', 'application/octet-stream').send(FIRMWARE_BYTES);
    assert.equal(noName.status, 400);
    const empty = await uploadFirmware({}, Buffer.alloc(0));
    assert.equal(empty.status, 400);
  });

  it('can be edited and deleted, and deleting removes the file from disk', async () => {
    const created = await uploadFirmware();
    const edited = await authed(request(app).patch(`/api/admin/firmware/${created.body.id}`)).send({ notes: 'Fixes the connector lock' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.notes, 'Fixes the connector lock');
    assert.equal(edited.body.version, '2.1.0');

    const row = await prisma.firmwarePackage.findUnique({ where: { id: created.body.id } });
    const onDisk = path.join(FILES_ROOT, 'firmware', row.storageKey);
    assert.ok(fs.existsSync(onDisk));
    const removed = await authed(request(app).delete(`/api/admin/firmware/${created.body.id}`));
    assert.equal(removed.status, 204);
    assert.equal(fs.existsSync(onDisk), false);
  });

  it('is refused to a viewer, who can see the list but not change it', async () => {
    const denied = await authed(request(app).post('/api/admin/firmware'), viewerToken)
      .query({ name: 'x', version: '1' }).set('Content-Type', 'application/octet-stream').send(FIRMWARE_BYTES);
    assert.equal(denied.status, 403);
    const list = await authed(request(app).get('/api/admin/firmware'), viewerToken);
    assert.equal(list.status, 200);
  });
});

describe('sending a firmware update', () => {
  it('gives the charge point a signed link that serves the file, and no other', async () => {
    await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ firmwareUpdateEnabled: true });
    const pkg = (await uploadFirmware()).body;
    const fake = connectFake();

    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/update-firmware`))
      .send({ firmwarePackageId: pkg.id });
    assert.equal(res.status, 202);
    const call = fake.calls.find((c) => c.method === 'UpdateFirmware');
    assert.ok(call, 'UpdateFirmware was sent');
    const link = pathOf(call.params.location);
    assert.match(link, new RegExp(`^/api/device-files/firmware/${pkg.id}/\\d+/[0-9a-f]{64}$`));

    const served = await request(app).get(link).buffer(true).parse(binaryParser);
    assert.equal(served.status, 200);
    assert.deepEqual(served.body, FIRMWARE_BYTES);

    const tampered = link.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'));
    assert.equal((await request(app).get(tampered)).status, 403);
    const otherPackage = link.replace(pkg.id, 'cnotarealpackageid');
    assert.equal((await request(app).get(otherPackage)).status, 403);
  });

  it('is refused when no public address is set for the site', async () => {
    await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ firmwareUpdateEnabled: true });
    const pkg = (await uploadFirmware()).body;
    const fake = connectFake();
    const { siteConfig } = await import('../src/services/runtimeConfig.js');
    const original = siteConfig().publicUrl;
    siteConfig().publicUrl = '';
    try {
      const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/update-firmware`))
        .send({ firmwarePackageId: pkg.id });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /public address/);
      assert.equal(fake.calls.length, 0);
    } finally {
      siteConfig().publicUrl = original;
    }
  });
});

describe('diagnostics logs', () => {
  beforeEach(async () => {
    await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ firmwareUpdateEnabled: true });
  });

  it('asks the charge point to upload to a one-time address, and stores the upload once', async () => {
    const fake = connectFake();
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/get-diagnostics`)).send({});
    assert.equal(res.status, 202);
    const call = fake.calls.find((c) => c.method === 'GetDiagnostics');
    const uploadPath = pathOf(call.params.location);
    assert.match(uploadPath, /^\/api\/device-files\/diagnostics\/[A-Za-z0-9_-]{43}$/);

    const pending = await prisma.diagnosticsLog.findUnique({ where: { id: res.body.id } });
    assert.equal(pending.status, 'REQUESTED');
    assert.equal(pending.storageKey, null);
    assert.equal(pending.tokenHash, hashUploadToken(uploadPath.split('/').pop()));

    const put = await request(app).put(uploadPath).set('Content-Type', 'text/plain').send(LOG_BYTES);
    assert.equal(put.status, 200);

    const uploaded = await prisma.diagnosticsLog.findUnique({ where: { id: res.body.id } });
    assert.equal(uploaded.status, 'UPLOADED');
    assert.equal(uploaded.sizeBytes, LOG_BYTES.length);
    assert.match(uploaded.fileName, /^CP-FW-.*\.log$/);

    const again = await request(app).put(uploadPath).set('Content-Type', 'text/plain').send(LOG_BYTES);
    assert.equal(again.status, 409);

    const list = await authed(request(app).get(`/api/admin/firmware/diagnostics?stationId=${station.id}`));
    assert.equal(list.body.data[0].status, 'UPLOADED');
    assert.equal(list.body.data[0].hasFile, true);

    const download = await authed(request(app).get(`/api/admin/firmware/diagnostics/${res.body.id}/download`)).buffer(true).parse(binaryParser);
    assert.deepEqual(download.body, LOG_BYTES);
  });

  it('refuses an upload to an expired address', async () => {
    connectFake();
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/get-diagnostics`)).send({});
    const uploadPath = pathOf(registryCallFor('GetDiagnostics').params.location);
    await prisma.diagnosticsLog.update({ where: { id: res.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const put = await request(app).put(uploadPath).set('Content-Type', 'text/plain').send(LOG_BYTES);
    assert.equal(put.status, 410);
  });

  it('marks the request failed when the charge point reports an upload failure', async () => {
    const fake = connectFake();
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/get-diagnostics`)).send({});
    assert.ok(fake.calls.length === 1);
    await markLatestDiagnosticsFailed(station.id);
    const row = await prisma.diagnosticsLog.findUnique({ where: { id: res.body.id } });
    assert.equal(row.status, 'FAILED');
  });

  it('reports a refused call as a failure and keeps no open request', async () => {
    connectFake({ GetDiagnostics: new Error('boom') });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/get-diagnostics`)).send({});
    assert.equal(res.status, 502);
    const logs = await prisma.diagnosticsLog.findMany({ where: { stationId: station.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'FAILED');
  });
});

// Looks up the last call a fake charge point received for a method.
function registryCallFor(method) {
  const client = registry.getClient('CP-FW');
  return [...client.calls].reverse().find((c) => c.method === method);
}

// Reads a binary response body into a Buffer.
function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
