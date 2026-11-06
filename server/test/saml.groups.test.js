import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { buildSignedSamlResponse, idpCertPem } from '../src/simulator/samlIdp.js';
import { prisma } from '../src/db.js';

const PERSISTENT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

async function configure(extra = {}) {
  const res = await request(app)
    .put('/api/admin/saml')
    .set('Authorization', `Bearer ${token}`)
    .send({
      enabled: true,
      idpEntityId: 'https://plugyard-test-idp.local/metadata',
      idpSsoUrl: 'http://localhost:7000/sso',
      idpCertificate: idpCertPem,
      autoProvision: true,
      ...extra,
    });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

function acs(options) {
  return request(app)
    .post('/api/auth/saml/acs')
    .type('form')
    .send({ SAMLResponse: buildSignedSamlResponse(options) });
}

async function createElectricianRole() {
  return prisma.customRole.create({ data: { name: 'Electrician', permissions: '["stations.view"]' } });
}

describe('NameID formats', () => {
  it('auto-provisions a persistent-NameID account, linked by NameID with the email from the attribute', async () => {
    await configure({ nameIdFormat: 'persistent' });
    const res = await acs({ email: 'pat@example.com', nameId: PERSISTENT_ID, nameIdFormat: 'persistent' });

    assert.equal(res.status, 302);
    const created = await prisma.admin.findUnique({ where: { email: 'pat@example.com' } });
    assert.equal(created.samlNameId, PERSISTENT_ID);
    assert.equal(created.role, 'VIEWER');
  });

  it('logs in an account by its NameID even when the email attribute has changed', async () => {
    await configure({ nameIdFormat: 'persistent' });
    await prisma.admin.create({ data: { email: 'old@example.com', passwordHash: null, samlNameId: PERSISTENT_ID } });

    const res = await acs({ email: 'new@example.com', nameId: PERSISTENT_ID, nameIdFormat: 'persistent' });
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.location).searchParams.get('email'), 'old@example.com');
    assert.equal(await prisma.admin.findUnique({ where: { email: 'new@example.com' } }), null);
  });

  it('links an existing account to its NameID on first persistent login, matched by email', async () => {
    await configure({ nameIdFormat: 'persistent' });
    await createAdmin({ email: 'link@example.com', password: null });

    const res = await acs({ email: 'link@example.com', nameId: PERSISTENT_ID, nameIdFormat: 'persistent' });
    assert.equal(res.status, 302);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'link@example.com' } })).samlNameId, PERSISTENT_ID);
  });

  it('rejects a login whose email account is already linked to a different identity', async () => {
    await configure({ nameIdFormat: 'persistent' });
    await prisma.admin.create({ data: { email: 'taken@example.com', passwordHash: null, samlNameId: 'someone-else' } });

    const res = await acs({ email: 'taken@example.com', nameId: PERSISTENT_ID, nameIdFormat: 'persistent' });
    assert.equal(res.status, 401);
  });

  it('keeps identifying by email when the NameID format is emailAddress', async () => {
    await configure({ nameIdFormat: 'emailAddress' });
    const res = await acs({ email: 'mail@example.com', nameIdFormat: 'emailAddress' });
    assert.equal(res.status, 302);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'mail@example.com' } })).samlNameId, null);
  });

  it('honours the unspecified format the same way as persistent', async () => {
    await configure({ nameIdFormat: 'unspecified' });
    const res = await acs({ email: 'uns@example.com', nameId: 'opaque-user-7', nameIdFormat: 'unspecified' });
    assert.equal(res.status, 302);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'uns@example.com' } })).samlNameId, 'opaque-user-7');
  });
});

describe('group-based roles', () => {
  it('gives a newly provisioned account the role of its mapped group', async () => {
    await createElectricianRole();
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [{ group: 'EV-Ops', role: 'Electrician' }],
      defaultRole: 'VIEWER',
    });

    const res = await acs({ email: 'ops@example.com', groups: ['EV-Ops'] });
    assert.equal(res.status, 302);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'ops@example.com' } })).role, 'Electrician');
  });

  it('updates an existing account role on each login to follow its groups', async () => {
    await createElectricianRole();
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [{ group: 'EV-Ops', role: 'Electrician' }],
      defaultRole: 'VIEWER',
    });
    await prisma.admin.create({ data: { email: 'move@example.com', passwordHash: null, role: 'VIEWER' } });

    await acs({ email: 'move@example.com', groups: ['EV-Ops'] });
    assert.equal((await prisma.admin.findUnique({ where: { email: 'move@example.com' } })).role, 'Electrician');

    await acs({ email: 'move@example.com', groups: [] });
    assert.equal((await prisma.admin.findUnique({ where: { email: 'move@example.com' } })).role, 'VIEWER');
  });

  it('uses the first matching mapping in list order', async () => {
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [
        { group: 'Admins', role: 'ADMIN' },
        { group: 'EV-Ops', role: 'VIEWER' },
      ],
      defaultRole: 'VIEWER',
    });

    await acs({ email: 'both@example.com', groups: ['EV-Ops', 'Admins'] });
    assert.equal((await prisma.admin.findUnique({ where: { email: 'both@example.com' } })).role, 'ADMIN');
  });

  it('matches group names exactly', async () => {
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [{ group: 'EV-Ops', role: 'ADMIN' }],
      defaultRole: 'VIEWER',
    });

    await acs({ email: 'case@example.com', groups: ['ev-ops'] });
    assert.equal((await prisma.admin.findUnique({ where: { email: 'case@example.com' } })).role, 'VIEWER');
  });

  it('denies a user in no mapped group when the default role is empty', async () => {
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [{ group: 'EV-Ops', role: 'ADMIN' }],
      defaultRole: null,
    });

    const res = await acs({ email: 'outsider@example.com', groups: ['Marketing'] });
    assert.equal(res.status, 403);
    assert.equal(await prisma.admin.findUnique({ where: { email: 'outsider@example.com' } }), null);
  });

  it('denies an existing account in no mapped group and leaves its role unchanged', async () => {
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [{ group: 'EV-Ops', role: 'ADMIN' }],
      defaultRole: null,
    });
    await prisma.admin.create({ data: { email: 'former@example.com', passwordHash: null, role: 'ADMIN' } });

    const res = await acs({ email: 'former@example.com', groups: [] });
    assert.equal(res.status, 403);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'former@example.com' } })).role, 'ADMIN');
  });

  it('leaves roles alone when no group attribute is set', async () => {
    await configure({ groupRoleMappings: [{ group: 'EV-Ops', role: 'ADMIN' }], groupAttribute: null });
    await prisma.admin.create({ data: { email: 'plain@example.com', passwordHash: null, role: 'VIEWER' } });

    const res = await acs({ email: 'plain@example.com', groups: ['EV-Ops'] });
    assert.equal(res.status, 302);
    assert.equal((await prisma.admin.findUnique({ where: { email: 'plain@example.com' } })).role, 'VIEWER');
  });
});

describe('SAML settings validation', () => {
  it('rejects an unknown NameID format', async () => {
    const res = await request(app)
      .put('/api/admin/saml')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameIdFormat: 'transient' });
    assert.equal(res.status, 400);
  });

  it('rejects a mapping to a role that does not exist', async () => {
    const res = await request(app)
      .put('/api/admin/saml')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupAttribute: 'groups', groupRoleMappings: [{ group: 'EV-Ops', role: 'Ghost' }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Ghost/);
  });

  it('stores mappings in order and returns them as a list', async () => {
    await createElectricianRole();
    await configure({
      groupAttribute: 'groups',
      groupRoleMappings: [
        { group: 'Admins', role: 'ADMIN' },
        { group: 'EV-Ops', role: 'Electrician' },
      ],
    });

    const { body } = await request(app).get('/api/admin/saml').set('Authorization', `Bearer ${token}`);
    assert.deepEqual(body.groupRoleMappings, [
      { group: 'Admins', role: 'ADMIN' },
      { group: 'EV-Ops', role: 'Electrician' },
    ]);
    assert.equal(body.defaultRole, 'VIEWER');
  });

  it('will not delete a custom role that a group mapping uses', async () => {
    await createElectricianRole();
    await configure({ groupAttribute: 'groups', groupRoleMappings: [{ group: 'EV-Ops', role: 'Electrician' }] });

    const blocked = await request(app).delete('/api/admin/roles/Electrician').set('Authorization', `Bearer ${token}`);
    assert.equal(blocked.status, 400);

    await configure({ groupRoleMappings: [] });
    const allowed = await request(app).delete('/api/admin/roles/Electrician').set('Authorization', `Bearer ${token}`);
    assert.equal(allowed.status, 204);
  });
});
