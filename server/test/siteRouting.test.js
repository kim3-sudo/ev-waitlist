import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { config } from '../src/config.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { sweepAllTenants } from '../src/services/reservationSweeper.js';

const SITE_B = 'site-b';
const PASSWORD = 'CorrectHorse1!';

let defaultAdmin;
let siteBAdmin;
let defaultStation;
let siteBStation;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });

  defaultAdmin = await createAdmin({ password: PASSWORD });
  siteBAdmin = await runWithTenant(SITE_B, () => createAdmin({ password: PASSWORD }));

  defaultStation = await prisma.station.create({ data: { identity: 'DEF-1', name: 'Default bay' } });
  siteBStation = await runWithTenant(SITE_B, () =>
    prisma.station.create({ data: { identity: 'B-1', name: 'Site B bay' } }),
  );
});

describe('admin sessions', () => {
  it('a token names the site of the admin who signed in', async () => {
    const token = await login(siteBAdmin.email);
    const payload = jwt.verify(token, config.jwtSecret);
    assert.equal(payload.tenantId, SITE_B);
  });

  it('admin lists only show their own site', async () => {
    const token = await login(siteBAdmin.email);
    const res = await request(app).get('/api/admin/stations').set(bearer(token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((s) => s.name), ['Site B bay']);
  });

  it('a site-B admin cannot change a default-site station', async () => {
    const token = await login(siteBAdmin.email);
    await request(app).put(`/api/admin/stations/${defaultStation.id}`).set(bearer(token)).send({ name: 'Hijacked' });
    const unchanged = await rawPrisma.station.findUnique({ where: { id: defaultStation.id } });
    assert.equal(unchanged.name, 'Default bay');
  });

  it('a token that names a different site than the admin row is refused', async () => {
    const forged = jwt.sign({ sub: siteBAdmin.id, tenantId: 'default' }, config.jwtSecret, { expiresIn: '1h' });
    const res = await request(app).get('/api/admin/stations').set(bearer(forged));
    assert.equal(res.status, 401);
  });

  it('the default admin does not see site-B stations', async () => {
    const token = await login(defaultAdmin.email);
    const res = await request(app).get('/api/admin/stations').set(bearer(token));
    assert.deepEqual(res.body.data.map((s) => s.name), ['Default bay']);
  });
});

describe('public routes follow the URL', () => {
  it('the un-prefixed routes serve the default site', async () => {
    const res = await request(app).get('/api/stations');
    assert.deepEqual(res.body.map((s) => s.name), ['Default bay']);
  });

  it('/api/t/<slug> serves that site', async () => {
    const res = await request(app).get(`/api/t/${SITE_B}/stations`);
    assert.deepEqual(res.body.map((s) => s.name), ['Site B bay']);
  });

  it('an unknown site is refused', async () => {
    const res = await request(app).get('/api/t/nowhere/stations');
    assert.equal(res.status, 404);
  });

  it('branding is per site', async () => {
    await request(app).get('/api/settings'); // creates the default row if missing
    await rawPrisma.settings.update({ where: { tenantId: 'default' }, data: { companyName: 'Default Co' } });
    await runWithTenant(SITE_B, () => prisma.settings.create({ data: { companyName: 'B Co' } }));

    assert.equal((await request(app).get('/api/settings')).body.companyName, 'Default Co');
    assert.equal((await request(app).get(`/api/t/${SITE_B}/settings`)).body.companyName, 'B Co');
  });
});

describe('links that carry no site', () => {
  it('a waitlist entry is found from its site without a site in the URL', async () => {
    const join = await request(app)
      .post(`/api/t/${SITE_B}/stations/${siteBStation.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.test', licensePlate: 'AB123' });
    assert.equal(join.status, 201);

    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.stationName, 'Site B bay');
  });

  it('a payment link is found from its site without a site in the URL', async () => {
    const charge = await runWithTenant(SITE_B, async () => {
      const transaction = await prisma.transaction.create({
        data: {
          stationId: siteBStation.id,
          connectorId: 1,
          idTag: 'TAG-B',
          ocppTransactionId: 1,
          meterStart: 0,
          meterStop: 1000,
          stoppedAt: new Date(),
        },
      });
      return prisma.charge.create({
        data: {
          token: 'token-site-b',
          stationId: siteBStation.id,
          transactionId: transaction.id,
          idTag: 'TAG-B',
          pricingModel: 'TIME',
          currency: 'USD',
          amountCents: 500,
          durationSeconds: 600,
          status: 'PENDING',
        },
      });
    });

    const res = await request(app).get(`/api/pay/${charge.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.stationName, 'Site B bay');
  });
});

describe('SAML and background work', () => {
  it('SAML is served under each site\'s own path', async () => {
    assert.equal((await request(app).get('/api/auth/saml/status')).status, 200);
    assert.equal((await request(app).get(`/api/t/${SITE_B}/auth/saml/status`)).status, 200);
  });

  it('the reservation sweeper expires holds in every site', async () => {
    const expired = new Date(Date.now() - 60_000);
    const reservation = await runWithTenant(SITE_B, async () => {
      const entry = await prisma.queueEntry.create({
        data: { stationId: siteBStation.id, name: 'Dana', contact: 'd@x.test', idTag: 'TAG-HOLD', position: 1, status: 'NOTIFIED' },
      });
      return prisma.reservation.create({
        data: { queueEntryId: entry.id, stationId: siteBStation.id, connectorId: 1, expiresAt: expired },
      });
    });

    await sweepAllTenants();

    // The hold is released (reservation CANCELLED) and the person in it is expired.
    const after = await rawPrisma.reservation.findUnique({ where: { id: reservation.id }, include: { queueEntry: true } });
    assert.equal(after.status, 'CANCELLED');
    assert.equal(after.queueEntry.status, 'EXPIRED');
  });
});
