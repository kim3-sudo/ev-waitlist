import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDb } from './support/db.js';
import { prisma, rawPrisma } from '../src/db.js';
import { recordAudit, flushAudit } from '../src/audit/record.js';
import { formatSyslogMessage, frameMessage } from '../src/audit/format.js';
import { readExporterConfig, createExporter, startAuditExporter, stopAuditExporter, setActiveExporter } from '../src/audit/exporter.js';
import { sweepAudit } from '../src/audit/retention.js';
import { clearAuditSettingsCache } from '../src/audit/settings.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'syslog');
const DAY = 24 * 60 * 60 * 1000;

// A collector that reads octet-counted syslog frames, as a SIEM would.
function startCollector({ secure = false } = {}) {
  const messages = [];
  const sockets = new Set();
  const handle = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const space = buffer.indexOf(' ');
        if (space < 0) break;
        const length = Number(buffer.slice(0, space));
        if (buffer.length < space + 1 + length) break;
        messages.push(buffer.slice(space + 1, space + 1 + length));
        buffer = buffer.slice(space + 1 + length);
      }
    });
  };
  const server = secure
    ? tls.createServer({ key: fs.readFileSync(path.join(FIXTURES, 'server.key')), cert: fs.readFileSync(path.join(FIXTURES, 'server.crt')) }, handle)
    : net.createServer(handle);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        messages,
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

function event(overrides = {}) {
  return { actorType: 'ADMIN', action: 'zones.create', outcome: 'SUCCESS', tenantId: 'default', actorLabel: 'pat@example.com', ip: '203.0.113.0', ...overrides };
}

beforeEach(async () => {
  await flushAudit();
  await resetDb();
  clearAuditSettingsCache();
});

describe('syslog message format', () => {
  const row = {
    id: 'evt1', seq: 7, at: new Date('2026-11-06T10:00:00.000Z'), tenantId: 'default',
    actorType: 'ADMIN', actorId: 'a1', actorLabel: 'pat@example.com', action: 'zones.create',
    targetType: 'zone', targetId: 'z1', targetLabel: 'Garage', outcome: 'SUCCESS', reason: null,
    changes: '{"fields":["name"]}', ip: '203.0.113.0', userAgent: 'test', requestId: null,
    prevHash: 'a'.repeat(64), hash: 'b'.repeat(64),
  };

  it('writes an RFC 5424 header with the event id in the structured data, and the event as JSON', () => {
    const msg = formatSyslogMessage(row, { hostname: 'plugyard-1', facility: 16, appName: 'plugyard' });
    assert.match(msg, /^<134>1 2026-11-06T10:00:00\.000Z plugyard-1 plugyard - zones\.create \[plugyard@32473 seq="7" hash="b{64}" outcome="SUCCESS"\] /);
    const body = JSON.parse(msg.slice(msg.indexOf('] ') + 2));
    assert.equal(body.seq, 7);
    assert.equal(body.prevHash, 'a'.repeat(64));
    assert.deepEqual(body.changes, { fields: ['name'] });
  });

  it('uses a warning priority for a denied request and an error priority for a failure', () => {
    assert.match(formatSyslogMessage({ ...row, outcome: 'DENIED' }, { hostname: 'h' }), /^<132>/);
    assert.match(formatSyslogMessage({ ...row, outcome: 'FAILED' }, { hostname: 'h' }), /^<131>/);
  });

  it('writes CEF when asked, escaping the characters CEF reserves', () => {
    const msg = formatSyslogMessage({ ...row, action: 'zones|create', reason: 'a=b' }, { format: 'cef', hostname: 'h' });
    assert.ok(msg.includes(' CEF:0|Plugyard|Plugyard|1|zones\\|create|zones\\|create|3|'));
    assert.ok(msg.includes('reason=a\\=b'));
    assert.ok(msg.includes('cs2=' + 'b'.repeat(64) + ' cs2Label=eventHash'));
  });

  it('frames each message with its byte length', () => {
    assert.equal(frameMessage('héllo'), '6 héllo');
  });
});

describe('exporter configuration', () => {
  it('is off unless a URL is set', () => {
    assert.equal(readExporterConfig({}).enabled, false);
  });

  it('defaults to port 6514 for TLS and 514 for TCP, and rejects bad values', () => {
    assert.equal(readExporterConfig({ AUDIT_SYSLOG_URL: 'tls://siem.example' }).port, 6514);
    assert.equal(readExporterConfig({ AUDIT_SYSLOG_URL: 'tcp://siem.example' }).port, 514);
    assert.throws(() => readExporterConfig({ AUDIT_SYSLOG_URL: 'udp://siem.example:514' }), /tls:\/\/ or tcp:\/\//);
    assert.throws(() => readExporterConfig({ AUDIT_SYSLOG_URL: 'tls://x:1', AUDIT_SYSLOG_FORMAT: 'xml' }), /FORMAT/);
    assert.throws(() => readExporterConfig({ AUDIT_SYSLOG_URL: 'not a url' }), /valid URL/);
  });

  it('reads certificates from files', () => {
    const config = readExporterConfig({
      AUDIT_SYSLOG_URL: 'tls://siem.example:6514',
      AUDIT_SYSLOG_CA_FILE: path.join(FIXTURES, 'ca.crt'),
    });
    assert.ok(Buffer.isBuffer(config.ca));
  });
});

describe('exporting to a collector', () => {
  it('sends events in order over TCP and marks them exported', async () => {
    const collector = await startCollector();
    try {
      for (let i = 1; i <= 3; i += 1) await recordAudit(event({ action: `step.${i}` }));
      await flushAudit();
      const exporter = createExporter({ config: { tls: false, host: '127.0.0.1', port: collector.port, format: 'json', appName: 'plugyard', facility: 16 }, hostname: 'h' });
      assert.equal(await exporter.flushOnce(), 3);
      await exporter.stop();
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(collector.messages.map((m) => JSON.parse(m.slice(m.indexOf('] ') + 2)).action), ['step.1', 'step.2', 'step.3']);
      assert.equal(await rawPrisma.auditEvent.count({ where: { exportedAt: null } }), 0);
    } finally {
      await collector.close();
    }
  });

  it('delivers over TLS, verifying the server certificate against the configured CA', async () => {
    const collector = await startCollector({ secure: true });
    try {
      await recordAudit(event({ action: 'secure.one' }));
      await flushAudit();
      const exporter = createExporter({
        config: {
          tls: true, host: 'localhost', port: collector.port, format: 'cef', appName: 'plugyard', facility: 16,
          ca: fs.readFileSync(path.join(FIXTURES, 'ca.crt')),
        },
        hostname: 'h',
      });
      assert.equal(await exporter.flushOnce(), 1);
      await exporter.stop();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(collector.messages.length, 1);
      assert.ok(collector.messages[0].includes('CEF:0|Plugyard'));
    } finally {
      await collector.close();
    }
  });

  it('refuses a server certificate it cannot verify, and keeps the events', async () => {
    const collector = await startCollector({ secure: true });
    try {
      await recordAudit(event({ action: 'untrusted' }));
      await flushAudit();
      // No CA configured, so the collector's certificate cannot be verified.
      const exporter = createExporter({
        config: { tls: true, host: 'localhost', port: collector.port, format: 'json', appName: 'plugyard', facility: 16 },
        hostname: 'h',
      });
      await assert.rejects(exporter.flushOnce());
      await exporter.stop();
      assert.equal(collector.messages.length, 0);
      assert.equal(await rawPrisma.auditEvent.count({ where: { exportedAt: null } }), 1);
    } finally {
      await collector.close();
    }
  });

  it('keeps events through an outage and sends them once the collector is back', async () => {
    // Find a free port, then close it so nothing is listening there yet.
    const probe = await startCollector();
    const port = probe.port;
    await probe.close();

    for (let i = 1; i <= 2; i += 1) await recordAudit(event({ action: `outage.${i}` }));
    await flushAudit();

    const exporter = createExporter({
      config: { tls: false, host: '127.0.0.1', port, format: 'json', appName: 'plugyard', facility: 16 },
      hostname: 'h',
    });
    await assert.rejects(exporter.flushOnce());
    assert.equal(await rawPrisma.auditEvent.count({ where: { exportedAt: null } }), 2, 'nothing was lost');
    assert.match((await exporter.status()).lastError, /ECONNREFUSED/);

    const collector = await startCollectorOn(port);
    try {
      assert.equal(await exporter.flushOnce(), 2);
      await exporter.stop();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(collector.messages.length, 2);
      assert.equal((await exporter.status()).state, 'OK');
    } finally {
      await collector.close();
    }
  });

  it('reports the backlog in its status', async () => {
    await recordAudit(event());
    await flushAudit();
    const exporter = createExporter({
      config: { tls: false, host: '127.0.0.1', port: 9, format: 'json', appName: 'plugyard', facility: 16 },
    });
    assert.equal((await exporter.status()).backlog, 1);
    await exporter.stop();
  });
});

describe('retention with an exporter', () => {
  it('keeps old events the collector has not received, and deletes old events it has', async () => {
    const collector = await startCollector();
    try {
      await recordAudit(event({ action: 'delivered' }));
      await recordAudit(event({ action: 'pending' }));
      await flushAudit();
      const old = new Date(Date.now() - 60 * DAY);
      await rawPrisma.auditEvent.updateMany({ data: { at: old } });
      // Only the first event reaches the collector.
      await rawPrisma.auditEvent.update({ where: { seq: 1 }, data: { exportedAt: new Date() } });

      // The exporter is configured, but its loop is not running, so the export state stays as set above.
      setActiveExporter(createExporter({ config: { tls: false, host: '127.0.0.1', port: collector.port, format: 'json', appName: 'plugyard', facility: 16 } }));
      try {
        const deleted = await sweepAudit();
        assert.equal(deleted, 1);
        const left = await rawPrisma.auditEvent.findMany();
        assert.deepEqual(left.map((r) => r.action), ['pending']);
      } finally {
        setActiveExporter(null);
      }
    } finally {
      await collector.close();
    }
  });
});

// Starts a collector on a given port (used to bring a collector back after an outage).
function startCollectorOn(port) {
  const messages = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const space = buffer.indexOf(' ');
        if (space < 0) break;
        const length = Number(buffer.slice(0, space));
        if (buffer.length < space + 1 + length) break;
        messages.push(buffer.slice(space + 1, space + 1 + length));
        buffer = buffer.slice(space + 1 + length);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        messages,
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      }),
    );
  });
}

after(async () => {
  await stopAuditExporter();
  await prisma.$disconnect?.();
});
