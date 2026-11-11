import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { rawPrisma } from '../src/db.js';
import { addressProblem, safeRequest, urlProblem } from '../src/utils/safeHttp.js';
import { dispatchWebhookDeliveries, emitEvent, urlProblem as webhookUrlProblem } from '../src/services/webhooks.js';
import { encryptSecret } from '../src/utils/secretBox.js';
import { discoverEndpoints, partnerRequest, partnerUrlProblem } from '../src/ocpi/client.js';

const PASSWORD = 'CorrectHorse1!';

// A local server that counts the requests it gets, to prove nothing was sent.
async function listen(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, hits, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Makes a name resolve to the given addresses, whatever it really is.
function resolveTo(name, ...addresses) {
  const real = dns.lookup;
  mock.method(dns, 'lookup', (host, options, callback) => {
    if (host !== name) return real(host, options, callback);
    callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  });
}

beforeEach(() => {
  mock.restoreAll();
  delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
  delete process.env.OCPI_ALLOW_PRIVATE_NETWORKS;
});

describe('addresses that may not be called', () => {
  it('blocks private, loopback, link-local, reserved and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::127.0.0.1',
      '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::',
    ]) {
      assert.ok(addressProblem(ip), ip);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(addressProblem(ip), null, ip);
    }
  });

  it('checks a web address: https, no credentials, no private or local host', () => {
    for (const url of [
      'http://example.com/hook', 'ftp://example.com', 'https://user:pw@example.com/', 'https://localhost/x', 'https://app.localhost/x',
      'https://printer.local/x', 'https://db.internal/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x',
      'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5:8443/x', 'https://2130706433/x', 'not a url', '',
    ]) {
      assert.ok(urlProblem(url), url);
      assert.ok(webhookUrlProblem(url), url);
    }
    assert.equal(urlProblem('https://example.com/hook'), null);
    assert.equal(urlProblem('http://127.0.0.1:8080/x', { allowPrivate: true }), null);
  });
});

describe('sending safely', () => {
  it('refuses a name that resolves to a private address, and sends nothing', async () => {
    const target = await listen((req, res) => res.end('ok'));
    resolveTo('rebind.example.test', '127.0.0.1');
    await assert.rejects(
      safeRequest(`http://rebind.example.test:${target.port}/`, { allowPrivate: false }),
      /http|https/, // plain http is refused before any lookup
    );
    await assert.rejects(safeRequest(`https://rebind.example.test:${target.port}/`), /resolves to 127\.0\.0\.1/);
    assert.equal(target.hits.length, 0);
    await target.close();
  });

  it('refuses a name when any one of its addresses is private', async () => {
    resolveTo('mixed.example.test', '8.8.8.8', '10.0.0.5');
    await assert.rejects(safeRequest('https://mixed.example.test/'), /resolves to 10\.0\.0\.5/);
  });

  it('refuses a name that resolves to an IPv6 form of a private address', async () => {
    resolveTo('six.example.test', '::ffff:127.0.0.1');
    await assert.rejects(safeRequest('https://six.example.test/'), /private or reserved/);
  });

  it('connects to the address it checked, not to a second lookup', async () => {
    const target = await listen((req, res) => res.end('hello'));
    resolveTo('pinned.example.test', '127.0.0.1');
    const res = await safeRequest(`http://pinned.example.test:${target.port}/path?q=1`, { allowPrivate: true, headers: { 'X-Test': '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'hello');
    assert.equal(target.hits[0].url, '/path?q=1');
    assert.equal(target.hits[0].headers.host, `pinned.example.test:${target.port}`);
    await target.close();
  });

  it('does not follow a redirect', async () => {
    const inner = await listen((req, res) => res.end('secret'));
    const outer = await listen((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${inner.port}/` });
      res.end();
    });
    const res = await safeRequest(`http://127.0.0.1:${outer.port}/`, { allowPrivate: true });
    assert.equal(res.status, 302);
    assert.equal(inner.hits.length, 0);
    await outer.close();
    await inner.close();
  });

  it('gives up on an oversized reply and on a silent server', async () => {
    const big = await listen((req, res) => res.end('x'.repeat(5000)));
    await assert.rejects(safeRequest(`http://127.0.0.1:${big.port}/`, { allowPrivate: true, maxBytes: 1000 }), /too large/);
    await big.close();
    const silent = await listen(() => {});
    await assert.rejects(safeRequest(`http://127.0.0.1:${silent.port}/`, { allowPrivate: true, timeoutMs: 200 }), /did not answer/);
    silent.server.closeAllConnections?.();
    await silent.close();
  });
});

describe('webhook delivery', () => {
  let token;
  beforeEach(async () => {
    await resetDb();
    await createAdmin({ email: 'ops@example.test', password: PASSWORD });
    token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
  });

  it('refuses to register a private, credentialed or non-https address', async () => {
    for (const url of ['https://169.254.169.254/x', 'https://[::ffff:10.0.0.1]/x', 'https://u:p@example.com/x', 'http://example.com/x']) {
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', `Bearer ${token}`).send({ url, events: ['*'] });
      assert.equal(res.status, 400, url);
    }
  });

  it('does not post to a registered name that now resolves to a private address', async () => {
    const target = await listen((req, res) => res.end('ok'));
    const endpoint = await rawPrisma.webhookEndpoint.create({
      data: {
        tenantId: 'default', url: `https://later-private.example.test:${target.port}/hook`, events: '*', active: true,
        secret: encryptSecret('whsec_test'),
      },
    });
    resolveTo('later-private.example.test', '127.0.0.1');
    await emitEvent('webhook.test', {});
    assert.equal(await dispatchWebhookDeliveries(), 1);
    const delivery = await rawPrisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
    assert.equal(delivery.status, 'PENDING');
    assert.match(delivery.lastError, /Could not reach the endpoint/);
    assert.equal(target.hits.length, 0);
    await target.close();
  });
});

describe('OCPI partners', () => {
  // A partner platform: a version list and its endpoint list, which can name other hosts.
  async function partnerServer(endpointsFor) {
    const s = await listen((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/versions') {
        return res.end(JSON.stringify({ data: [{ version: '2.2.1', url: `http://127.0.0.1:${s.port}/2.2.1` }] }));
      }
      if (req.url === '/2.2.1') return res.end(JSON.stringify({ data: { endpoints: endpointsFor(s.port) } }));
      res.end(JSON.stringify({ data: {} }));
    });
    return s;
  }

  it('refuses http and private addresses unless the operator allows them', async () => {
    const partner = await partnerServer((port) => [{ identifier: 'locations', url: `http://127.0.0.1:${port}/locations` }]);
    const refused = await discoverEndpoints(`http://127.0.0.1:${partner.port}/versions`, 'tok');
    assert.equal(refused.ok, false);
    assert.match(refused.error, /refused/);
    assert.equal(partner.hits.length, 0);

    process.env.OCPI_ALLOW_PRIVATE_NETWORKS = '1';
    const allowed = await discoverEndpoints(`http://127.0.0.1:${partner.port}/versions`, 'tok');
    assert.equal(allowed.ok, true);
    await partner.close();
  });

  it('refuses endpoints on a different host, and never sends the token there', async () => {
    process.env.OCPI_ALLOW_PRIVATE_NETWORKS = '1';
    const elsewhere = await listen((req, res) => res.end('{}'));
    const partner = await partnerServer(() => [
      { identifier: 'locations', url: `http://127.0.0.1:${elsewhere.port}/steal` }, // other port = other origin
    ]);
    const res = await discoverEndpoints(`http://127.0.0.1:${partner.port}/versions`, 'tok');
    assert.equal(res.ok, false);
    assert.match(res.error, /same host/);
    assert.equal(elsewhere.hits.length, 0);
    await partner.close();
    await elsewhere.close();
  });

  it('refuses a versions list that points the 2.2.1 address somewhere else', async () => {
    process.env.OCPI_ALLOW_PRIVATE_NETWORKS = '1';
    const elsewhere = await listen((req, res) => res.end('{}'));
    const bad = await listen((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ version: '2.2.1', url: `http://127.0.0.1:${elsewhere.port}/2.2.1` }] }));
    });
    const res = await discoverEndpoints(`http://127.0.0.1:${bad.port}/versions`, 'tok');
    assert.equal(res.ok, false);
    assert.equal(elsewhere.hits.length, 0);
    await bad.close();
    await elsewhere.close();
  });

  it('only calls stored partner addresses on the partner\'s own host', async () => {
    process.env.OCPI_ALLOW_PRIVATE_NETWORKS = '1';
    const elsewhere = await listen((req, res) => res.end('{}'));
    const partner = { theirVersionsUrl: 'http://127.0.0.1:9/versions', theirTokenEnc: encryptSecret('tok') };
    const res = await partnerRequest(partner, 'GET', `http://127.0.0.1:${elsewhere.port}/x`);
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.match(res.error, /same host/);
    assert.equal(elsewhere.hits.length, 0);
    await elsewhere.close();
  });

  it('checks the host, scheme and private-network rules together', () => {
    assert.match(partnerUrlProblem('https://ocpi.partner.example/versions', 'https://evil.example/x'), /same host/);
    assert.match(partnerUrlProblem('https://ocpi.partner.example/versions', 'http://ocpi.partner.example/x'), /https/);
    assert.match(partnerUrlProblem('https://10.0.0.1/versions', 'https://10.0.0.1/x'), /private/);
    assert.equal(partnerUrlProblem('https://ocpi.partner.example/versions', 'https://ocpi.partner.example/2.2.1/locations'), null);
    assert.match(partnerUrlProblem(null, 'https://ocpi.partner.example/x'), /same host/);
  });
});
