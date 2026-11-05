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

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

describe('charge point identity checks', () => {
  it('reports an unused identity as available', async () => {
    const res = await authed(request(app).get('/api/admin/stations/identity-check')).query({ identity: 'CP-9' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { available: true, error: null });
  });

  it('reports a taken identity as unavailable', async () => {
    await authed(request(app).post('/api/admin/stations')).send({ identity: 'CP-9', name: 'Taken' });
    const res = await authed(request(app).get('/api/admin/stations/identity-check')).query({ identity: 'CP-9' });
    assert.equal(res.body.available, false);
    assert.match(res.body.error, /already exists/);
  });

  it('rejects identities with spaces or slashes', async () => {
    for (const identity of ['CP 1', 'CP/1', '']) {
      const res = await authed(request(app).get('/api/admin/stations/identity-check')).query({ identity });
      assert.equal(res.body.available, false, identity);
    }
  });

  it('rejects an invalid identity on create', async () => {
    const res = await authed(request(app).post('/api/admin/stations')).send({ identity: 'bad/id', name: 'Bad' });
    assert.equal(res.status, 400);
  });

  it('rejects an invalid identity on update', async () => {
    const created = await authed(request(app).post('/api/admin/stations')).send({ identity: 'CP-1', name: 'Ok' });
    const res = await authed(request(app).put(`/api/admin/stations/${created.body.id}`)).send({ identity: 'no good' });
    assert.equal(res.status, 400);
  });
});
