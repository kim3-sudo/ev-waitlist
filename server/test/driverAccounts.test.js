import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { issueSignInCode } from '../src/services/driverAccounts.js';

const ADMIN_PASSWORD = 'CorrectHorse1!';
let adminToken;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: ADMIN_PASSWORD });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: ADMIN_PASSWORD });
  adminToken = body.token;
});

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// Signs a driver in with a fresh one-time code, the way the driver page does.
async function signInDriver(email, name) {
  const { code } = await issueSignInCode(email);
  const res = await request(app).post('/api/auth/code/verify').send({ email, code, name });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

async function setSettings(fields) {
  return request(app).put('/api/admin/settings').set(bearer(adminToken)).send(fields);
}

async function makeStation(identity = 'CP-JOIN') {
  return prisma.station.create({
    data: {
      identity,
      name: 'Bay',
      connectors: { create: [{ connectorId: 1, standard: 'IEC_62196_T2', format: 'SOCKET', powerType: 'AC_3_PHASE', maxVoltage: 400, maxAmperage: 32 }] },
    },
  });
}

describe('driver sign-in', () => {
  it('a sign-in code is sent by e-mail, and the reply does not say whether the account exists', async () => {
    // Tests have no e-mail set up, so the request is refused with a clear message rather than sent.
    const res = await request(app).post('/api/auth/code/request').send({ email: 'dana@example.test' });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'EMAIL_NOT_SET_UP');
  });

  it('a new e-mail address gets a driver account on the first correct code', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const me = await request(app).get('/api/driver/me').set(bearer(token));
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'dana@example.test');
    assert.equal(me.body.name, 'Dana');
    assert.equal(me.body.hasPassword, false);
    assert.deepEqual(me.body.vehicles, []);
  });

  it('refuses a wrong code, and a code cannot be used twice', async () => {
    const { code } = await issueSignInCode('sam@example.test');
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await request(app).post('/api/auth/code/verify').send({ email: 'sam@example.test', code: wrong });
    assert.equal(bad.status, 401);

    const good = await request(app).post('/api/auth/code/verify').send({ email: 'sam@example.test', code });
    assert.equal(good.status, 200);
    const again = await request(app).post('/api/auth/code/verify').send({ email: 'sam@example.test', code });
    assert.equal(again.status, 401);
  });

  it('stops accepting a code after five wrong guesses', async () => {
    const { code } = await issueSignInCode('lee@example.test');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/code/verify').send({ email: 'lee@example.test', code: wrong });
    }
    const res = await request(app).post('/api/auth/code/verify').send({ email: 'lee@example.test', code });
    assert.equal(res.status, 401);
  });

  it('an admin e-mail cannot sign in with a code, so two-factor sign-in cannot be skipped', async () => {
    const admin = await prisma.admin.findFirst({ where: { role: 'ADMIN' } });
    const { code } = await issueSignInCode(admin.email);
    const res = await request(app).post('/api/auth/code/verify').send({ email: admin.email, code });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'PASSWORD_SIGN_IN_REQUIRED');
  });
});

describe('driver accounts and the admin pages', () => {
  it('a driver cannot use admin pages, even the ones that only need a sign-in', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const audit = await request(app).get('/api/admin/audit').set(bearer(token));
    assert.equal(audit.status, 403);
    assert.equal(audit.body.code, 'DRIVER_ACCOUNT');

    const stations = await request(app).get('/api/admin/stations').set(bearer(token));
    assert.equal(stations.status, 403);
  });

  it('driver accounts do not appear in the admin list of users', async () => {
    await signInDriver('dana@example.test', 'Dana');
    const list = await request(app).get('/api/admin/users').set(bearer(adminToken));
    assert.equal(list.status, 200);
    assert.ok(!list.body.data.some((u) => u.email === 'dana@example.test'));
  });

  it('a driver signs in with a password they set, and the admin sign-in refuses the driver', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const set = await request(app).put('/api/driver/password').set(bearer(token)).send({ newPassword: 'PlugAndGo2026' });
    assert.equal(set.status, 200);

    // Driver accounts use the same sign-in as admins, and get a session without a second factor.
    const login = await request(app).post('/api/auth/login').send({ email: 'dana@example.test', password: 'PlugAndGo2026' });
    assert.equal(login.status, 200);
    assert.equal(login.body.role, 'DRIVER');
    assert.equal(login.body.mfaRequired, undefined);
    const me = await request(app).get('/api/driver/me').set(bearer(login.body.token));
    assert.equal(me.status, 200);
  });

  it('changing a password needs the current one', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    await request(app).put('/api/driver/password').set(bearer(token)).send({ newPassword: 'PlugAndGo2026' });
    const noCurrent = await request(app).put('/api/driver/password').set(bearer(token)).send({ newPassword: 'AnotherOne2026' });
    assert.equal(noCurrent.status, 401);
    const wrong = await request(app).put('/api/driver/password').set(bearer(token)).send({ currentPassword: 'nope-nope', newPassword: 'AnotherOne2026' });
    assert.equal(wrong.status, 401);
  });

  it('keeps the name and phone on the account', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const res = await request(app).put('/api/driver/me').set(bearer(token)).send({ name: 'Dana Lee', phone: '+1 555 123 4567' });
    assert.equal(res.status, 200);
    const me = await request(app).get('/api/driver/me').set(bearer(token));
    assert.equal(me.body.name, 'Dana Lee');
    assert.equal(me.body.phone, '+15551234567');
  });
});

describe('vehicles and the charge points they can use', () => {
  it('a driver adds a vehicle with the plugs it can charge with, and edits and removes it', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const created = await request(app).post('/api/driver/vehicles').set(bearer(token)).send({
      name: 'My IONIQ 5',
      make: 'Hyundai',
      model: 'IONIQ 5',
      plugs: ['IEC_62196_T1', 'TESLA_S', 'IEC_62196_T1_COMBO'],
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.plugs, ['IEC_62196_T1', 'TESLA_S', 'IEC_62196_T1_COMBO']);

    const edited = await request(app).put(`/api/driver/vehicles/${created.body.id}`).set(bearer(token)).send({ plugs: ['TESLA_S'] });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.plugs, ['TESLA_S']);
    assert.equal(edited.body.name, 'My IONIQ 5');

    const removed = await request(app).delete(`/api/driver/vehicles/${created.body.id}`).set(bearer(token));
    assert.equal(removed.status, 200);
    const list = await request(app).get('/api/driver/vehicles').set(bearer(token));
    assert.deepEqual(list.body, []);
  });

  it('refuses a plug that is not known, and a vehicle with no plug', async () => {
    const token = await signInDriver('dana@example.test', 'Dana');
    const unknown = await request(app).post('/api/driver/vehicles').set(bearer(token)).send({ name: 'Car', plugs: ['BANANA'] });
    assert.equal(unknown.status, 400);
    const none = await request(app).post('/api/driver/vehicles').set(bearer(token)).send({ name: 'Car', plugs: [] });
    assert.equal(none.status, 400);
  });

  it("one driver cannot change another driver's vehicle", async () => {
    const dana = await signInDriver('dana@example.test', 'Dana');
    const sam = await signInDriver('sam@example.test', 'Sam');
    const car = await request(app).post('/api/driver/vehicles').set(bearer(dana)).send({ name: 'Car', plugs: ['TESLA_S'] });
    const res = await request(app).put(`/api/driver/vehicles/${car.body.id}`).set(bearer(sam)).send({ name: 'Mine now' });
    assert.equal(res.status, 404);
  });
});

describe('the waitlist and driver accounts', () => {
  it('a site that requires accounts refuses a guest, and joins a signed-in driver with the account e-mail', async () => {
    await makeStation();
    await setSettings({ driverAccounts: 'REQUIRED' });
    const station = await prisma.station.findFirst({});

    const guest = await request(app).post(`/api/stations/${station.id}/waitlist`).send({ name: 'Guest', contact: 'guest@example.test', licensePlate: 'GST123', plateRegion: '' });
    assert.equal(guest.status, 401);
    assert.equal(guest.body.code, 'ACCOUNT_REQUIRED');

    const token = await signInDriver('dana@example.test', 'Dana');
    const joined = await request(app).post(`/api/stations/${station.id}/waitlist`).set(bearer(token)).send({ licensePlate: 'DRV123', plateRegion: '' });
    assert.equal(joined.status, 201);
    const entry = await prisma.queueEntry.findUnique({ where: { id: joined.body.id } });
    assert.equal(entry.contact, 'dana@example.test');
    assert.equal(entry.name, 'Dana');
  });

  it('a guest can join without contact details when the site does not require them', async () => {
    await makeStation();
    await setSettings({ waitlistContactRequired: false });
    const station = await prisma.station.findFirst({});
    const res = await request(app).post(`/api/stations/${station.id}/waitlist`).send({ name: 'Guest', licensePlate: 'GST123', plateRegion: '' });
    assert.equal(res.status, 201);
    const entry = await prisma.queueEntry.findUnique({ where: { id: res.body.id } });
    assert.equal(entry.contact, '');
  });

  it('a guest must give contact details when the site requires them', async () => {
    await makeStation();
    await setSettings({ waitlistContactRequired: true });
    const station = await prisma.station.findFirst({});
    const res = await request(app).post(`/api/stations/${station.id}/waitlist`).send({ name: 'Guest', licensePlate: 'GST123', plateRegion: '' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /e-mail address/);
  });

  it('refuses an unknown driver accounts setting', async () => {
    const res = await setSettings({ driverAccounts: 'SOMETIMES' });
    assert.equal(res.status, 400);
  });
});
