import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

describe('GET /api/settings (public)', () => {
  it('returns defaults with no auth required', async () => {
    const res = await request(app).get('/api/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.companyName, 'EV Waitlist');
    assert.equal(res.body.mfaRequired, false);
  });
});

describe('PUT /api/admin/settings', () => {
  it('requires authentication', async () => {
    const res = await request(app).put('/api/admin/settings').send({ mfaRequired: true });
    assert.equal(res.status, 401);
  });

  it('updates branding fields', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Acme Charging', primaryColor: '#123456' });
    assert.equal(res.status, 200);
    assert.equal(res.body.companyName, 'Acme Charging');
    assert.equal(res.body.primaryColor, '#123456');
  });

  it('flipping mfaRequired alone does not clobber previously saved branding', async () => {
    await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Acme Charging' });

    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ mfaRequired: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaRequired, true);
    assert.equal(res.body.companyName, 'Acme Charging');
  });

  it('rejects an invalid identifierMode', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ identifierMode: 'NOT_A_MODE' });
    assert.equal(res.status, 400);
  });
});
