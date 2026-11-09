import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RPCClient } from 'ocpp-rpc';
import request from 'supertest';
import { app } from './support/testApp.js';
import { createAdmin } from './support/factories.js';
import { resetDb } from './support/db.js';
import { prisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { DRIVER_ROLE } from '../src/auth/permissions.js';
import { createCentralSystem } from '../src/ocpp/centralSystem.js';
import { sweepRetention } from '../src/services/retentionSweeper.js';
import { isWaitlistAuthorized } from '../src/services/payments/holds.js';
import { joinQueue } from '../src/services/queueService.js';
import {
  ensureCredential,
  revokeCredentials,
  translateIdTag,
} from '../src/services/wallet/credentialService.js';

const inSite = (fn) => runWithTenant(DEFAULT_TENANT_ID, fn);
const TAG_PATTERN = /^[0-9A-F]{12}$/;

// A charge point with one connector, a driver account with a wallet credential, and a waitlist
// entry for that driver. The entry is due (NOTIFIED with an ACTIVE reservation) unless told otherwise.
async function fixture({ identity = 'WALLET-1', status = 'NOTIFIED', reserved = true } = {}) {
  return inSite(async () => {
    const station = await prisma.station.create({ data: { identity, name: identity, walletTap: true } });
    await prisma.connector.create({ data: { stationId: station.id, connectorId: 1, status: 'Available' } });
    const account = await prisma.admin.create({
      data: { email: `${identity.toLowerCase()}@example.test`, role: DRIVER_ROLE, name: 'Dana' },
    });
    const credential = await ensureCredential(account.id);
    const entry = await prisma.queueEntry.create({
      data: {
        stationId: station.id,
        name: 'Dana',
        contact: account.email,
        idTag: 'ENTRYTAG01',
        position: 1,
        status,
        accountId: account.id,
      },
    });
    if (reserved) {
      await prisma.reservation.create({
        data: {
          queueEntryId: entry.id,
          stationId: station.id,
          connectorId: 1,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          status: 'ACTIVE',
        },
      });
    }
    return { station, account, credential, entry };
  });
}

describe('wallet credentials', () => {
  beforeEach(resetDb);

  it('issues a 12-character hex tag once, and returns the same one after that', async () => {
    const { account } = await fixture();
    const first = await inSite(() => ensureCredential(account.id));
    const second = await inSite(() => ensureCredential(account.id));
    assert.match(first.idTag, TAG_PATTERN);
    assert.equal(second.id, first.id);
  });

  it('stops a revoked tag from translating, and issues a new tag next time', async () => {
    const { account, credential } = await fixture();
    const revoked = await inSite(() => revokeCredentials(account.id));
    assert.equal(revoked, 1);

    const translated = await inSite(() => translateIdTag('WALLET-1', credential.idTag));
    assert.equal(translated.idTag, credential.idTag, 'a revoked tag is not translated');

    const replacement = await inSite(() => ensureCredential(account.id));
    assert.notEqual(replacement.idTag, credential.idTag);
  });
});

describe('translating a wallet tag', () => {
  beforeEach(resetDb);

  it('turns a driver whose turn it is into their waitlist tag, with the reservation expiry', async () => {
    const { credential, station } = await fixture();
    const result = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(result.idTag, 'ENTRYTAG01');
    assert.ok(result.expiresAt instanceof Date);
  });

  it('leaves the tag alone when the driver is not yet notified', async () => {
    const { credential, station } = await fixture({ status: 'WAITING', reserved: false });
    const result = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(result.idTag, credential.idTag);
    assert.equal(result.expiresAt, undefined);
  });

  it('leaves the tag alone at a different charge point', async () => {
    const { credential } = await fixture();
    const other = await inSite(() => prisma.station.create({ data: { identity: 'OTHER-1', name: 'Other' } }));
    const result = await inSite(() => translateIdTag(other.id, credential.idTag));
    assert.equal(result.idTag, credential.idTag);
  });

  it('leaves the tag alone when the reservation is no longer active', async () => {
    const { credential, entry, station } = await fixture();
    await inSite(() =>
      prisma.reservation.updateMany({ where: { queueEntryId: entry.id }, data: { status: 'EXPIRED' } }),
    );
    const result = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(result.idTag, credential.idTag);
  });

  it('passes every other tag through unchanged, such as a waitlist tag or an RFID card', async () => {
    const { station } = await fixture();
    assert.equal((await inSite(() => translateIdTag(station.id, 'ENTRYTAG01'))).idTag, 'ENTRYTAG01');
    assert.equal((await inSite(() => translateIdTag(station.id, 'CARD-UNKNOWN'))).idTag, 'CARD-UNKNOWN');
  });

  it('is accepted by the waitlist check only for the driver whose turn it is', async () => {
    const { credential, station } = await fixture();
    const translated = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(await inSite(() => isWaitlistAuthorized(station.id, translated.idTag)), true);
    assert.equal(await inSite(() => isWaitlistAuthorized(station.id, credential.idTag)), false);
  });
});

describe('joining the waitlist while signed in', () => {
  beforeEach(resetDb);

  it('links the waitlist entry to the driver account', async () => {
    const { station, account } = await fixture({ identity: 'JOIN-1', status: 'WAITING', reserved: false });
    const entry = await inSite(() =>
      joinQueue(
        { stationId: station.id },
        { name: 'Sam', contact: 'sam@example.test', accountId: account.id },
      ),
    );
    assert.equal(entry.accountId, account.id);
  });

  it('leaves the link empty for a guest', async () => {
    const { station } = await fixture({ identity: 'GUEST-1', status: 'WAITING', reserved: false });
    const entry = await inSite(() => joinQueue({ stationId: station.id }, { name: 'Sam', contact: 'sam@example.test' }));
    assert.equal(entry.accountId, null);
  });
});

// The charge point side: a real OCPP 1.6J connection to the central system, so the handlers
// run exactly as they do in production.
describe('charge point messages with a wallet tag', () => {
  let httpServer;
  let port;
  const clients = [];

  before(async () => {
    const central = createCentralSystem();
    httpServer = http.createServer();
    httpServer.on('upgrade', central.handleUpgrade);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  after(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(resetDb);

  async function connect(identity) {
    const client = new RPCClient({
      endpoint: `ws://localhost:${port}/ocpp`,
      identity,
      protocols: ['ocpp1.6'],
      strictMode: true,
    });
    await client.connect();
    clients.push(client);
    return client;
  }

  it('answers Authorize with Accepted and the turn end time when the driver is due', async () => {
    const { credential, station } = await fixture({ identity: 'OCPP-1' });
    const cp = await connect(station.identity);
    const reply = await cp.call('Authorize', { idTag: credential.idTag });
    assert.equal(reply.idTagInfo.status, 'Accepted');
    assert.ok(!Number.isNaN(Date.parse(reply.idTagInfo.expiryDate)), 'expiryDate is a timestamp');
  });

  it('answers Authorize with Blocked when the driver is not due', async () => {
    const { credential, station } = await fixture({ identity: 'OCPP-2', status: 'WAITING', reserved: false });
    const cp = await connect(station.identity);
    const reply = await cp.call('Authorize', { idTag: credential.idTag });
    assert.equal(reply.idTagInfo.status, 'Blocked');
  });

  it('starts the session under the waitlist tag and completes the entry', async () => {
    const { credential, station, entry } = await fixture({ identity: 'OCPP-3' });
    const cp = await connect(station.identity);
    const reply = await cp.call('StartTransaction', {
      connectorId: 1,
      idTag: credential.idTag,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    assert.equal(reply.idTagInfo.status, 'Accepted');

    const tx = await inSite(() =>
      prisma.transaction.findFirst({ where: { stationId: station.id, ocppTransactionId: reply.transactionId } }),
    );
    assert.equal(tx.idTag, 'ENTRYTAG01', 'the transaction records the waitlist tag');

    const after = await inSite(() => prisma.queueEntry.findUnique({ where: { id: entry.id } }));
    assert.equal(after.status, 'COMPLETED');
  });

  it('refuses StartTransaction for a wallet tag that is not due', async () => {
    const { credential, station } = await fixture({ identity: 'OCPP-4', status: 'WAITING', reserved: false });
    const cp = await connect(station.identity);
    const reply = await cp.call('StartTransaction', {
      connectorId: 1,
      idTag: credential.idTag,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    assert.equal(reply.idTagInfo.status, 'Blocked');
    assert.equal(reply.transactionId, 0);
  });
});

describe('turning wallet passes on for a charge point', () => {
  beforeEach(resetDb);

  it('does not translate a pass at a charge point that is not flagged for wallet passes', async () => {
    const { credential, station } = await fixture();
    await inSite(() => prisma.station.update({ where: { id: station.id }, data: { walletTap: false } }));
    const result = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(result.idTag, credential.idTag);
  });

  it('lets an admin turn it on when adding a charge point, and off and on again when editing', async () => {
    const admin = await createAdmin({ password: 'Password123!' });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password123!' });
    const token = login.body.token;

    const created = await request(app)
      .post('/api/admin/stations')
      .set('Authorization', `Bearer ${token}`)
      .send({ identity: 'TAP-NEW', name: 'Tap new', connectorCount: 1, walletTap: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.walletTap, true);

    const id = created.body.id;
    const off = await request(app)
      .put(`/api/admin/stations/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ walletTap: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.body.walletTap, false);

    // Saving without the field leaves the setting as it is.
    const untouched = await request(app)
      .put(`/api/admin/stations/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tap new renamed' });
    assert.equal(untouched.body.walletTap, false);

    const on = await request(app)
      .put(`/api/admin/stations/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ walletTap: true });
    assert.equal(on.body.walletTap, true);
  });

  it('refuses anything other than true or false', async () => {
    const admin = await createAdmin({ password: 'Password123!' });
    const token = (await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })).body.token;
    const res = await request(app)
      .post('/api/admin/stations')
      .set('Authorization', `Bearer ${token}`)
      .send({ identity: 'TAP-BAD', name: 'Tap bad', connectorCount: 1, walletTap: 'yes' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /walletTap must be true or false/);
  });
});

describe('erasing a driver and deleting an account', () => {
  beforeEach(resetDb);

  it('erasing a waitlist entry revokes the owner’s pass and unlinks the entry', async () => {
    const { credential, entry, station } = await fixture();
    const admin = await createAdmin({ password: 'Password123!' });
    const token = (await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })).body.token;

    const res = await request(app)
      .post('/api/admin/privacy/erase')
      .set('Authorization', `Bearer ${token}`)
      .send({ queueEntryId: entry.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.walletCredentialsRevoked, 1);

    const row = await inSite(() => prisma.walletCredential.findUnique({ where: { id: credential.id } }));
    assert.ok(row.revokedAt, 'the credential is revoked');
    const after = await inSite(() => prisma.queueEntry.findUnique({ where: { id: entry.id } }));
    assert.equal(after.accountId, null);
    const translated = await inSite(() => translateIdTag(station.id, credential.idTag));
    assert.equal(translated.idTag, credential.idTag, 'the revoked tag no longer translates');
  });

  it('deleting a driver account removes its passes', async () => {
    const { credential, account } = await fixture();
    const admin = await createAdmin({ password: 'Password123!' });
    const token = (await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })).body.token;

    const res = await request(app).delete(`/api/admin/users/${account.id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 204);
    const gone = await inSite(() => prisma.walletCredential.findUnique({ where: { id: credential.id } }));
    assert.equal(gone, null);
  });
});

describe('retention of wallet passes', () => {
  beforeEach(resetDb);

  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n) => new Date(Date.now() - n * DAY);

  // An account whose pass was issued long ago. Its waitlist history is whatever the caller adds.
  async function oldAccount(email) {
    return inSite(async () => {
      const account = await prisma.admin.create({ data: { email, role: DRIVER_ROLE } });
      const credential = await ensureCredential(account.id);
      await prisma.walletCredential.update({ where: { id: credential.id }, data: { issuedAt: daysAgo(60) } });
      return { account, credential };
    });
  }

  it('revokes a pass that has gone unused for the queue period', async () => {
    const { credential } = await oldAccount('idle@example.test');
    const result = await inSite(() => sweepRetention());
    assert.equal(result.walletCredentials, 1);
    const row = await inSite(() => prisma.walletCredential.findUnique({ where: { id: credential.id } }));
    assert.ok(row.revokedAt);
  });

  it('keeps a pass whose driver had a waitlist entry within the queue period', async () => {
    const { account, credential } = await oldAccount('recent@example.test');
    await inSite(async () => {
      const station = await prisma.station.create({ data: { identity: 'RET-1', name: 'Ret' } });
      await prisma.queueEntry.create({
        data: {
          stationId: station.id,
          name: 'Dana',
          contact: account.email,
          idTag: 'RECENT01',
          position: 1,
          status: 'COMPLETED',
          closedAt: daysAgo(1),
          accountId: account.id,
        },
      });
    });
    const result = await inSite(() => sweepRetention());
    assert.equal(result.walletCredentials, 0);
    const row = await inSite(() => prisma.walletCredential.findUnique({ where: { id: credential.id } }));
    assert.equal(row.revokedAt, null);
  });

  it('keeps a pass whose driver is still waiting in the queue', async () => {
    const { account, credential } = await oldAccount('waiting@example.test');
    await inSite(async () => {
      const station = await prisma.station.create({ data: { identity: 'RET-2', name: 'Ret two' } });
      await prisma.queueEntry.create({
        data: { stationId: station.id, name: 'Sam', contact: account.email, idTag: 'WAIT0001', position: 1, status: 'WAITING', accountId: account.id },
      });
    });
    await inSite(() => sweepRetention());
    const row = await inSite(() => prisma.walletCredential.findUnique({ where: { id: credential.id } }));
    assert.equal(row.revokedAt, null);
  });

  it('unlinks a closed entry from its account once its personal details are cleared', async () => {
    const { account } = await oldAccount('unlink@example.test');
    const entry = await inSite(async () => {
      const station = await prisma.station.create({ data: { identity: 'RET-3', name: 'Ret three' } });
      return prisma.queueEntry.create({
        data: {
          stationId: station.id,
          name: 'Dana',
          contact: account.email,
          idTag: 'OLD00001',
          position: 1,
          status: 'COMPLETED',
          closedAt: daysAgo(60),
          accountId: account.id,
        },
      });
    });
    await inSite(() => sweepRetention());
    const after = await inSite(() => prisma.queueEntry.findUnique({ where: { id: entry.id } }));
    assert.equal(after.contact, '');
    assert.equal(after.accountId, null);
  });
});
