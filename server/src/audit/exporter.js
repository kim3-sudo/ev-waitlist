import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import { rawPrisma } from '../db.js';
import { formatSyslogMessage, frameMessage, FORMATS, syslogHostname } from './format.js';

// Sends audit events to a syslog server or SIEM over TLS (or plain TCP, for a collector on a
// trusted network). Events go in sequence order. An event is marked exported only after
// its bytes have been written, so delivery is at-least-once: a restart can send an event
// twice. Each message carries the event's seq and hash, so the SIEM can deduplicate.
//
// Configuration, from the environment:
//   AUDIT_SYSLOG_URL        tls://host:6514 (recommended) or tcp://host:514
//   AUDIT_SYSLOG_FORMAT     json (default) or cef
//   AUDIT_SYSLOG_CA_FILE    CA certificate that signed the server's certificate (PEM)
//   AUDIT_SYSLOG_CERT_FILE  client certificate, for servers that require one (PEM, optional)
//   AUDIT_SYSLOG_KEY_FILE   the client certificate's private key (PEM, optional)
//   AUDIT_SYSLOG_APP_NAME   the APP-NAME field (default plugyard)
//   AUDIT_SYSLOG_FACILITY   syslog facility number (default 16, local0)
// Certificates are read from files, never from the database. Server certificates are
// always verified.

const BATCH_SIZE = 100;
const POLL_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

export function readExporterConfig(env = process.env) {
  const raw = env.AUDIT_SYSLOG_URL?.trim();
  if (!raw) return { enabled: false };

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('AUDIT_SYSLOG_URL is not a valid URL (use tls://host:port or tcp://host:port)');
  }
  if (url.protocol !== 'tls:' && url.protocol !== 'tcp:') {
    throw new Error('AUDIT_SYSLOG_URL must start with tls:// or tcp://');
  }
  const format = (env.AUDIT_SYSLOG_FORMAT ?? 'json').toLowerCase();
  if (!FORMATS.includes(format)) throw new Error(`AUDIT_SYSLOG_FORMAT must be one of ${FORMATS.join(', ')}`);
  const tlsOn = url.protocol === 'tls:';
  const facility = Number.parseInt(env.AUDIT_SYSLOG_FACILITY ?? '16', 10);
  if (!Number.isInteger(facility) || facility < 0 || facility > 23) throw new Error('AUDIT_SYSLOG_FACILITY must be 0 to 23');

  return {
    enabled: true,
    tls: tlsOn,
    host: url.hostname,
    port: Number(url.port || (tlsOn ? 6514 : 514)),
    format,
    appName: env.AUDIT_SYSLOG_APP_NAME || 'plugyard',
    facility,
    ca: env.AUDIT_SYSLOG_CA_FILE ? fs.readFileSync(env.AUDIT_SYSLOG_CA_FILE) : undefined,
    cert: env.AUDIT_SYSLOG_CERT_FILE ? fs.readFileSync(env.AUDIT_SYSLOG_CERT_FILE) : undefined,
    key: env.AUDIT_SYSLOG_KEY_FILE ? fs.readFileSync(env.AUDIT_SYSLOG_KEY_FILE) : undefined,
  };
}

// Opens a TCP or TLS connection. Resolves once it is ready to write.
export function connectSocket(config) {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port };
    const socket = config.tls
      ? tls.connect({ ...options, servername: config.host, ca: config.ca, cert: config.cert, key: config.key, rejectUnauthorized: true })
      : net.connect(options);
    const ready = config.tls ? 'secureConnect' : 'connect';
    socket.once(ready, () => resolve(socket));
    socket.once('error', reject);
  });
}

function writeAll(socket, data) {
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createExporter({
  config,
  connect = connectSocket,
  pollMs = POLL_MS,
  batchSize = BATCH_SIZE,
  hostname = syslogHostname(),
  log = (msg) => console.error(msg),
} = {}) {
  let socket = null;
  let running = false;
  let loopPromise = null;
  const state = { lastExportAt: null, exportedThroughSeq: null, lastError: null, consecutiveFailures: 0 };

  function dropSocket() {
    if (socket) socket.destroy();
    socket = null;
  }

  async function ensureSocket() {
    if (socket && !socket.destroyed) return socket;
    socket = await connect(config);
    socket.on('error', (err) => {
      state.lastError = err.message;
      dropSocket();
    });
    socket.on('close', () => {
      socket = null;
    });
    return socket;
  }

  // Sends one batch of unexported events. Returns how many were sent.
  async function sendBatch() {
    const rows = await rawPrisma.auditEvent.findMany({
      where: { exportedAt: null },
      orderBy: { seq: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) return 0;

    const sock = await ensureSocket();
    for (const row of rows) {
      const message = formatSyslogMessage(row, { format: config.format, appName: config.appName, facility: config.facility, hostname });
      await writeAll(sock, frameMessage(message));
    }
    await rawPrisma.auditEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { exportedAt: new Date() },
    });
    state.exportedThroughSeq = rows[rows.length - 1].seq;
    state.lastExportAt = new Date();
    state.lastError = null;
    state.consecutiveFailures = 0;
    return rows.length;
  }

  // Runs one pass and reports the outcome. Used by the loop, and directly by tests.
  async function flushOnce() {
    try {
      return await sendBatch();
    } catch (err) {
      state.lastError = err.message;
      state.consecutiveFailures += 1;
      dropSocket();
      throw err;
    }
  }

  async function loop() {
    while (running) {
      try {
        const sent = await flushOnce();
        if (sent === 0) await sleep(pollMs);
      } catch (err) {
        log(`[audit] SIEM export failed (will retry): ${err.message}`);
        const backoff = Math.min(MAX_BACKOFF_MS, pollMs * 2 ** Math.min(state.consecutiveFailures, 6));
        await sleep(backoff);
      }
    }
  }

  return {
    config,
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      dropSocket();
      if (loopPromise) await loopPromise.catch(() => {});
      loopPromise = null;
    },
    flushOnce,
    async status() {
      const backlog = await rawPrisma.auditEvent.count({ where: { exportedAt: null } });
      return {
        enabled: true,
        destination: `${config.tls ? 'tls' : 'tcp'}://${config.host}:${config.port}`,
        format: config.format,
        connected: Boolean(socket && !socket.destroyed),
        state: state.lastError ? 'ERROR' : 'OK',
        lastError: state.lastError,
        lastExportAt: state.lastExportAt,
        exportedThroughSeq: state.exportedThroughSeq,
        backlog,
      };
    },
  };
}

// The exporter for this process, from the environment.
let active = null;

export function isExporterEnabled() {
  return active !== null;
}

export function startAuditExporter(env = process.env) {
  const config = readExporterConfig(env);
  if (!config.enabled) return null;
  active = createExporter({ config });
  active.start();
  console.log(`[audit] exporting audit events to ${config.tls ? 'tls' : 'tcp'}://${config.host}:${config.port} (${config.format})`);
  return active;
}

export async function stopAuditExporter() {
  if (active) await active.stop();
  active = null;
}

export function currentExporter() {
  return active;
}

// Makes an exporter the active one without starting its loop. Retention uses this to know
// that an exporter is configured. Tests use it to keep the export timing under their control.
export function setActiveExporter(exporter) {
  active = exporter;
}
