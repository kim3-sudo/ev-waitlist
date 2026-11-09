import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { ROAMING_WARNING_CORE, ROAMING_TERMS_VERSION } from '../src/services/roaming.js';

const PASSWORD = 'Password123!';
let adminToken;
let viewerToken;
let station;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token;
}
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: PASSWORD });
  const viewer = await createAdmin({ password: PASSWORD });
  await rawPrisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
  adminToken = await login(admin.email);
  viewerToken = await login(viewer.email);
  station = await prisma.station.create({ data: { identity: 'ROAM-1', name: 'Roaming bay' } });
});

const siteRow = () => rawPrisma.tenant.findUnique({ where: { id: 'default' } });

describe('roaming switch', () => {
  it('is off by default, and public readers see it off', async () => {
    const res = await request(app).get('/api/settings/roaming');
    assert.equal(res.body.enabled, false);
  });

  it('cannot be turned on until the terms are acknowledged', async () => {
    const res = await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'ROAMING_TERMS_NOT_ACKNOWLEDGED');
    assert.equal((await siteRow()).roamingEnabled, false);
  });

  it('turns on when acknowledged in the same request, recording who and which terms', async () => {
    const res = await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true, acknowledge: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, true);
    const row = await siteRow();
    assert.equal(row.roamingEnabled, true);
    assert.equal(row.roamingTermsAcknowledgedVersion, ROAMING_TERMS_VERSION);
    assert.ok(row.roamingTermsAcknowledgedBy);
  });

  it('disabling keeps the acknowledgement, so turning it back on does not ask again', async () => {
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true, acknowledge: true });
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: false });
    assert.ok((await siteRow()).roamingTermsAcknowledgedAt);

    const again = await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true });
    assert.equal(again.status, 200);
  });

  it('changing the warning text clears the acknowledgement and turns roaming off', async () => {
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true, acknowledge: true });
    const changed = await request(app)
      .put('/api/admin/roaming')
      .set(bearer(adminToken))
      .send({ warningExtra: 'This parking lot closes at 22:00.' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.enabled, false);
    assert.equal((await siteRow()).roamingTermsAcknowledgedAt, null);

    const reenable = await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true });
    assert.equal(reenable.status, 409);
  });

  it('a viewer cannot change roaming', async () => {
    const res = await request(app).put('/api/admin/roaming').set(bearer(viewerToken)).send({ enabled: true, acknowledge: true });
    assert.equal(res.status, 403);
  });

  it('refuses extra warning text over the limit', async () => {
    const res = await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ warningExtra: 'x'.repeat(1001) });
    assert.equal(res.status, 400);
  });
});

describe('the warning', () => {
  it('always includes the required core, with the site text after it', async () => {
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ warningExtra: 'Site-specific note.' });
    const res = await request(app).get('/api/settings/roaming');
    assert.ok(res.body.warningText.startsWith(ROAMING_WARNING_CORE));
    assert.ok(res.body.warningText.endsWith('Site-specific note.'));
  });
});

describe('joining a waitlist on a site with roaming on', () => {
  beforeEach(async () => {
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: true, acknowledge: true });
  });

  it('refuses a join that has not accepted the warning', async () => {
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.test', licensePlate: 'AB12' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'ROAMING_WARNING_REQUIRED');
  });

  it('accepts a join that has accepted the warning', async () => {
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.test', licensePlate: 'AB12', roamingWarningAccepted: true });
    assert.equal(res.status, 201);
  });

  it('does not ask for the warning on a site with roaming off', async () => {
    await request(app).put('/api/admin/roaming').set(bearer(adminToken)).send({ enabled: false });
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.test', licensePlate: 'AB12' });
    assert.equal(res.status, 201);
  });
});
