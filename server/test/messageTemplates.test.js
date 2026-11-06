import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { fill, renderMessage, templateProblem, TEMPLATE_KEYS } from '../src/services/messageTemplates.js';

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

describe('message templates', () => {
  it('fills in placeholders and leaves out missing ones', () => {
    assert.equal(fill('{a} and {b}', { a: 'x' }), 'x and ');
  });

  it('uses the built-in wording until a site changes it', async () => {
    const msg = await renderMessage('MOVE_VEHICLE', { station: 'Bay 3' });
    assert.equal(msg.subject, 'Please move your vehicle');
    assert.equal(
      msg.body,
      'Your charging session at Bay 3 is complete. Please unplug and move your vehicle for the next person.',
    );
  });

  it('refuses a placeholder the message does not have', () => {
    const problem = templateProblem('MOVE_VEHICLE', { subject: 'Hi', body: 'Hello {driver}', sms: 'Hi' });
    assert.match(problem, /\{driver\} isn't available/);
  });

  it('refuses empty wording', () => {
    assert.ok(templateProblem('READY_TO_CHARGE', { subject: '', body: 'x' }));
    assert.ok(templateProblem('READY_TO_CHARGE', { subject: 'x', body: '   ' }));
  });

  it('lists every message with the built-in wording and no customization', async () => {
    const res = await authed(request(app).get('/api/admin/templates'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.key), TEMPLATE_KEYS);
    assert.ok(res.body.every((t) => t.customized === false));
  });

  it('saves a change, uses it when sending, and resets it', async () => {
    const saved = await authed(request(app).put('/api/admin/templates/MOVE_VEHICLE')).send({
      subject: 'Move your car',
      body: 'Please move your car from {station} now.',
      sms: 'Move your car from {station}.',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.customized, true);

    const msg = await renderMessage('MOVE_VEHICLE', { station: 'Bay 3' });
    assert.equal(msg.subject, 'Move your car');
    assert.equal(msg.body, 'Please move your car from Bay 3 now.');

    const reset = await authed(request(app).delete('/api/admin/templates/MOVE_VEHICLE'));
    assert.equal(reset.status, 200);
    assert.equal(reset.body.customized, false);
    assert.equal((await renderMessage('MOVE_VEHICLE', { station: 'Bay 3' })).subject, 'Please move your vehicle');
  });

  it('rejects a change with an unknown placeholder', async () => {
    const res = await authed(request(app).put('/api/admin/templates/PAYMENT_DUE')).send({
      subject: 'Pay',
      body: 'Pay {amount} to {owner}',
      sms: 'Pay {amount}',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /\{owner\}/);
  });

  it('returns 404 for an unknown message', async () => {
    const res = await authed(request(app).put('/api/admin/templates/NOPE')).send({ subject: 'x', body: 'y', sms: 'z' });
    assert.equal(res.status, 404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/templates');
    assert.equal(res.status, 401);
  });
});
