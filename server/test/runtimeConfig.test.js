import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { encryptSecret, decryptSecret } from '../src/utils/secretBox.js';
import { initRuntimeConfig, validateValue } from '../src/services/runtimeConfig.js';
import { spEntityId } from '../src/services/samlService.js';

async function login(email) {
  const { body } = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return body.token;
}
const as = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

let adminToken;
beforeEach(async () => {
  await resetDb();
  await initRuntimeConfig(); // back to defaults: no rows, no env seeds
  const admin = await createAdmin({ email: 'owner@example.com' });
  adminToken = await login(admin.email);
});

describe('secret encryption', () => {
  it('round-trips a secret and never stores it in plain text', () => {
    const stored = encryptSecret('sk_live_abc123');
    assert.notEqual(stored.includes('sk_live_abc123'), true);
    assert.equal(decryptSecret(stored), 'sk_live_abc123');
  });

  it('cannot be read back with a different encryption key', () => {
    const stored = encryptSecret('sk_live_abc123');
    const original = config.encryptionKey;
    config.encryptionKey = 'some-other-key';
    try {
      assert.throws(() => decryptSecret(stored));
    } finally {
      config.encryptionKey = original;
    }
  });
});

describe('integrations (payment provider keys)', () => {
  it('saves a key encrypted and never returns it', async () => {
    const res = await as(adminToken)(request(app).put('/api/admin/integrations')).send({
      'stripe.secretKey': 'sk_test_visible_never',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.secretsSet['stripe.secretKey'], true);
    assert.equal(JSON.stringify(res.body).includes('sk_test_visible_never'), false);

    const row = await prisma.configValue.findUnique({ where: { key: 'stripe.secretKey' } });
    assert.equal(row.value.includes('sk_test_visible_never'), false);
    assert.equal(config.stripe.secretKey, 'sk_test_visible_never');
  });

  it('clears a secret when it is saved as an empty string', async () => {
    await as(adminToken)(request(app).put('/api/admin/integrations')).send({ 'stripe.secretKey': 'sk_test_1' });
    const res = await as(adminToken)(request(app).put('/api/admin/integrations')).send({ 'stripe.secretKey': '' });
    assert.equal(res.body.secretsSet['stripe.secretKey'], false);
    assert.equal(config.stripe.secretKey, '');
  });

  it('refuses to save a secret when no encryption key is configured', async () => {
    const original = config.encryptionKey;
    config.encryptionKey = '';
    try {
      const res = await as(adminToken)(request(app).put('/api/admin/integrations')).send({ 'square.accessToken': 'EAAA' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /CONFIG_ENCRYPTION_KEY/);
    } finally {
      config.encryptionKey = original;
    }
  });

  it('shows Configured on the provider once all its fields are saved', async () => {
    await as(adminToken)(request(app).put('/api/admin/integrations')).send({
      'square.accessToken': 'EAAA',
      'square.locationId': 'LOC1',
      'square.webhookSignatureKey': 'sig',
    });
    const res = await as(adminToken)(request(app).get('/api/admin/integrations'));
    assert.equal(res.body.providers.SQUARE.configured, true);
    assert.equal(res.body.values['square.locationId'], 'LOC1');
  });

  it('rejects a provider test when its keys are missing', async () => {
    const res = await as(adminToken)(request(app).post('/api/admin/integrations/STRIPE/test'));
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });

  it('a role without integrations.manage cannot read or change keys', async () => {
    await prisma.customRole.create({ data: { name: 'Payments viewer', permissions: JSON.stringify(['payments.view']) } });
    const user = await createAdmin({ email: 'viewer-pay@example.com' });
    await prisma.admin.update({ where: { id: user.id }, data: { role: 'Payments viewer' } });
    const token = await login(user.email);
    assert.equal((await as(token)(request(app).get('/api/admin/integrations'))).status, 403);
    assert.equal((await as(token)(request(app).put('/api/admin/integrations'))).status, 403);
  });
});

describe('system settings', () => {
  it('changes the public URL, and SAML picks it up without a restart', async () => {
    const res = await as(adminToken)(request(app).put('/api/admin/system')).send({
      publicUrl: 'https://ev.example.com/',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.values.publicUrl, 'https://ev.example.com');
    assert.equal(spEntityId(), 'https://ev.example.com/api/auth/saml/metadata');
  });

  it('validates URLs and the reservation window', async () => {
    const badUrl = await as(adminToken)(request(app).put('/api/admin/system')).send({ webUrl: 'not a url' });
    assert.equal(badUrl.status, 400);
    const badWindow = await as(adminToken)(request(app).put('/api/admin/system')).send({ reservationWindowMinutes: 0 });
    assert.equal(badWindow.status, 400);
    const good = await as(adminToken)(request(app).put('/api/admin/system')).send({ reservationWindowMinutes: 20 });
    assert.equal(good.body.values.reservationWindowMinutes, 20);
    assert.equal(config.reservationWindowMinutes, 20);
  });

  it("does not let a system-only change touch provider keys", async () => {
    const res = await as(adminToken)(request(app).put('/api/admin/system')).send({ 'stripe.secretKey': 'sk_test_x' });
    assert.equal(res.status, 400);
  });

  it('derives the Square webhook URL from the public URL when left blank', async () => {
    await as(adminToken)(request(app).put('/api/admin/system')).send({ publicUrl: 'https://ev.example.com' });
    assert.equal(config.square.webhookUrl, 'https://ev.example.com/api/payments/square/webhook');
  });
});

describe('one-time import from environment variables', () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RESERVATION_WINDOW_MINUTES;
  });

  it('seeds the database from env the first time, then ignores env', async () => {
    // Start from an empty table: the project .env may already have seeded rows in beforeEach.
    await prisma.configValue.deleteMany();
    process.env.STRIPE_SECRET_KEY = 'sk_test_from_env';
    process.env.RESERVATION_WINDOW_MINUTES = '25';
    await initRuntimeConfig();
    assert.equal(config.stripe.secretKey, 'sk_test_from_env');
    assert.equal(config.reservationWindowMinutes, 25);
    const row = await prisma.configValue.findUnique({ where: { key: 'stripe.secretKey' } });
    assert.equal(row.value.includes('sk_test_from_env'), false, 'imported secret is encrypted');

    // A later change in the database wins over the env value still in the environment.
    await as(adminToken)(request(app).put('/api/admin/system')).send({ reservationWindowMinutes: 30 });
    process.env.RESERVATION_WINDOW_MINUTES = '99';
    await initRuntimeConfig();
    assert.equal(config.reservationWindowMinutes, 30);
  });
});

describe('validateValue', () => {
  it('normalizes URLs and enums', () => {
    assert.equal(validateValue('webUrl', ' https://a.example.com/ ').value, 'https://a.example.com');
    assert.ok(validateValue('braintree.environment', 'staging').error);
    assert.equal(validateValue('braintree.environment', 'production').value, 'production');
  });
});
