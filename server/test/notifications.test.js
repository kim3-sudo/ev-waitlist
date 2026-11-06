import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { setSiteSettings } from './support/siteSettings.js';
import { initRuntimeConfig, validateValue } from '../src/services/runtimeConfig.js';
import { notifyDriver } from '../src/services/notifier.js';
import { looksLikeEmail, normalizePhone } from '../src/services/contact.js';
import { renderMessage } from '../src/services/messageTemplates.js';
import { prisma } from '../src/db.js';

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;
let token;
let sent;

beforeEach(async () => {
  await resetDb();
  await initRuntimeConfig();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
  sent = [];
  // Records every outgoing HTTP request instead of sending it.
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
});

const authed = (req) => req.set('Authorization', `Bearer ${token}`);

const MESSAGE = { subject: 'Your charger is ready', body: 'Plug in now.', sms: 'Plug in now (text).' };

async function createStation() {
  const res = await authed(request(app).post('/api/admin/stations')).send({
    identity: 'CP-SMS',
    name: 'Garage B',
    location: 'Level 2',
    connectorCount: 1,
  });
  return res.body;
}

describe('contact checks', () => {
  it('recognises e-mail addresses', () => {
    assert.equal(looksLikeEmail('dana@example.com'), true);
    assert.equal(looksLikeEmail('+15551234567'), false);
    assert.equal(looksLikeEmail('dana at example'), false);
  });

  it('accepts only full international mobile numbers, stored without spaces', () => {
    assert.equal(normalizePhone('+1 555 123 4567'), '+15551234567');
    assert.equal(normalizePhone('+44 (20) 7946-0018'), '+442079460018');
    assert.equal(normalizePhone('555 123 4567'), null);
    assert.equal(normalizePhone('+0123'), null);
  });

  it('checks the new per-site settings', () => {
    assert.match(validateValue('email.fromAddress', 'not-an-address').error, /e-mail address/);
    assert.equal(validateValue('email.fromAddress', 'no-reply@example.com').value, 'no-reply@example.com');
    assert.match(validateValue('email.provider', 'MAILGUN').error, /must be one of/);
    assert.match(validateValue('sms.provider', 'SMTP').error, /must be one of/);
  });
});

describe('sending to a driver', () => {
  it('writes to the server log when no e-mail or text provider is connected', async () => {
    const logged = [];
    console.log = (line) => logged.push(line);
    await notifyDriver({ contact: 'dana@example.com', smsNumber: '+15551234567' }, MESSAGE);
    assert.equal(sent.length, 0);
    assert.equal(logged.length, 2);
    assert.match(logged[0], /dana@example\.com.*E-mail is not connected/);
    assert.match(logged[1], /\+15551234567.*Text messages are not connected/);
  });

  it('sends e-mail through the chosen provider', async () => {
    await setSiteSettings({
      'email.provider': 'POSTMARK',
      'email.fromAddress': 'no-reply@example.com',
      'email.fromName': 'Garage Waitlist',
      'email.postmark.serverToken': 'pm-token',
    });
    await notifyDriver({ contact: 'dana@example.com', smsNumber: null }, MESSAGE);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.postmarkapp.com/email');
    assert.equal(sent[0].init.headers['X-Postmark-Server-Token'], 'pm-token');
    const body = JSON.parse(sent[0].init.body);
    assert.equal(body.To, 'dana@example.com');
    assert.equal(body.Subject, 'Your charger is ready');
    assert.equal(body.TextBody, 'Plug in now.');
  });

  it('sends a text message to the number the driver elected, using the SMS wording', async () => {
    await setSiteSettings({
      'email.provider': 'NONE',
      'sms.provider': 'TWILIO',
      'sms.twilio.accountSid': 'AC123',
      'sms.twilio.authToken': 'twilio-secret',
      'sms.twilio.sender': '+15550001111',
    });
    await notifyDriver({ contact: 'dana@example.com', smsNumber: '+1 555 123 4567' }, MESSAGE);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const form = new URLSearchParams(sent[0].init.body);
    assert.equal(form.get('To'), '+15551234567');
    assert.equal(form.get('From'), '+15550001111');
    assert.equal(form.get('Body'), 'Plug in now (text).');
    assert.match(sent[0].init.headers.Authorization, /^Basic /);
  });

  it('uses a Messaging Service SID when the sender starts with MG', async () => {
    await setSiteSettings({
      'sms.provider': 'TWILIO',
      'sms.twilio.accountSid': 'AC123',
      'sms.twilio.authToken': 'twilio-secret',
      'sms.twilio.sender': 'MG0123456789abcdef',
    });
    await notifyDriver({ contact: '+15551234567', smsNumber: null }, MESSAGE);
    const form = new URLSearchParams(sent[0].init.body);
    assert.equal(form.get('MessagingServiceSid'), 'MG0123456789abcdef');
    assert.equal(form.get('From'), null);
  });

  it('keeps the text message wording unless the site changes it', async () => {
    const msg = await renderMessage('MOVE_VEHICLE', { station: 'Bay 3' });
    assert.match(msg.sms, /Bay 3/);
    assert.match(msg.sms, /move your vehicle/);
  });
});

describe('joining with a text message', () => {
  it('shows text messages as unavailable until a provider is connected', async () => {
    const res = await request(app).get('/api/settings');
    assert.equal(res.body.smsAvailable, false);
    await setSiteSettings({
      'sms.provider': 'TWILIO',
      'sms.twilio.accountSid': 'AC123',
      'sms.twilio.authToken': 'twilio-secret',
      'sms.twilio.sender': '+15550001111',
    });
    assert.equal((await request(app).get('/api/settings')).body.smsAvailable, true);
  });

  it('refuses a text message number while text messages are not set up', async () => {
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-CA', smsNumber: '+15551234567' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /aren't set up/);
  });

  it('accepts only an e-mail address as the contact while text messages are off', async () => {
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: '+15551234567', licensePlate: 'ABC123', plateRegion: 'US-CA' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Enter an email address/);
  });

  it('refuses a number without its country code', async () => {
    await setSiteSettings({
      'sms.provider': 'TWILIO',
      'sms.twilio.accountSid': 'AC123',
      'sms.twilio.authToken': 'twilio-secret',
      'sms.twilio.sender': '+15550001111',
    });
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-CA', smsNumber: '555 123 4567' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /country code/);
  });

  it('stores the elected number on the waitlist entry', async () => {
    await setSiteSettings({
      'sms.provider': 'TWILIO',
      'sms.twilio.accountSid': 'AC123',
      'sms.twilio.authToken': 'twilio-secret',
      'sms.twilio.sender': '+15550001111',
    });
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-CA', smsNumber: '+1 555 123 4567' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const entry = await prisma.queueEntry.findUnique({ where: { id: res.body.id } });
    assert.equal(entry.smsNumber, '+15551234567');
  });
});

describe('admin e-mail and text message pages', () => {
  it('saves the e-mail settings and never returns the secret', async () => {
    const saved = await authed(request(app).put('/api/admin/email')).send({
      provider: undefined,
      'email.provider': 'SENDGRID',
      'email.fromAddress': 'no-reply@example.com',
      'email.sendgrid.apiKey': 'SG.secret-key',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.values['email.provider'], 'SENDGRID');
    assert.equal(saved.body.secretsSet['email.sendgrid.apiKey'], true);
    assert.equal(JSON.stringify(saved.body).includes('SG.secret-key'), false);
  });

  it('refuses a change to the SMS settings from the e-mail page', async () => {
    const res = await authed(request(app).put('/api/admin/email')).send({ 'sms.provider': 'TWILIO' });
    assert.equal(res.status, 400);
  });

  it('will not send a test e-mail until a provider is set up', async () => {
    const res = await authed(request(app).post('/api/admin/email/test')).send({ to: 'me@example.com' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not connected/);
  });

  it('sends a test e-mail through the configured provider', async () => {
    await setSiteSettings({
      'email.provider': 'POSTMARK',
      'email.fromAddress': 'no-reply@example.com',
      'email.postmark.serverToken': 'pm-token',
    });
    const res = await authed(request(app).post('/api/admin/email/test')).send({ to: 'me@example.com' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(JSON.parse(sent[0].init.body).To, 'me@example.com');
  });

  it('refuses a test text message to a number without its country code', async () => {
    const res = await authed(request(app).post('/api/admin/sms/test')).send({ to: '555 123 4567' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /country code/);
  });

  it('refuses SMS wording that is too long, and saves wording that fits', async () => {
    const tooLong = await authed(request(app).put('/api/admin/templates/NEXT_IN_LINE')).send({
      subject: 'Next',
      body: 'Next in line.',
      sms: 'x'.repeat(481),
    });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.error, /480/);

    const ok = await authed(request(app).put('/api/admin/templates/NEXT_IN_LINE')).send({
      subject: 'Next',
      body: 'Next in line.',
      sms: 'Next in line for {station}.',
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await renderMessage('NEXT_IN_LINE', { station: 'Bay 3' })).sms, 'Next in line for Bay 3.');
  });
});
