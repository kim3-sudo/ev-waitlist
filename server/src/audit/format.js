import os from 'node:os';

// Turns an audit row into a syslog message (RFC 5424), framed for TCP and TLS.
// The body is JSON (the default) or CEF, which ArcSight and many SIEMs read natively.

export const FORMATS = ['json', 'cef'];

const SEVERITY = { SUCCESS: 6, DENIED: 4, FAILED: 3 }; // informational, warning, error
const CEF_SEVERITY = { SUCCESS: 3, DENIED: 6, FAILED: 5 };

// SD-PARAM values escape ", \ and ].
const sdEscape = (value) => String(value).replace(/[\\"\]]/g, (c) => `\\${c}`);
// CEF header fields escape \ and |; extension values escape \ and =.
const cefHeader = (value) => String(value).replace(/[\\|]/g, (c) => `\\${c}`);
const cefExt = (value) => String(value).replace(/[\\=]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

// Header tokens must be printable ASCII without spaces.
const token = (value, max = 48) => {
  const clean = String(value ?? '-').replace(/[^\x21-\x7e]/g, '_');
  return (clean || '-').slice(0, max);
};

export function syslogHostname() {
  return token(os.hostname(), 255);
}

function jsonBody(row) {
  return JSON.stringify({
    id: row.id,
    seq: row.seq,
    at: new Date(row.at).toISOString(),
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    outcome: row.outcome,
    reason: row.reason,
    changes: row.changes ? JSON.parse(row.changes) : null,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    prevHash: row.prevHash,
    hash: row.hash,
  });
}

function cefBody(row) {
  const header = ['CEF:0', 'Plugyard', 'Plugyard', '1', row.action, row.action, CEF_SEVERITY[row.outcome] ?? 5]
    .map((v, i) => (i < 6 ? cefHeader(v) : String(v)))
    .join('|');
  const ext = [
    `rt=${new Date(row.at).getTime()}`,
    `outcome=${cefExt(row.outcome)}`,
    row.actorLabel && `suser=${cefExt(row.actorLabel)}`,
    row.actorId && `suid=${cefExt(row.actorId)}`,
    row.ip && `src=${cefExt(row.ip)}`,
    row.targetId && `duid=${cefExt(row.targetId)}`,
    row.reason && `reason=${cefExt(row.reason)}`,
    row.requestId && `requestId=${cefExt(row.requestId)}`,
    row.tenantId && `cs1=${cefExt(row.tenantId)} cs1Label=tenant`,
    `cs2=${cefExt(row.hash)} cs2Label=eventHash`,
    `cs3=${cefExt(row.seq)} cs3Label=sequence`,
  ]
    .filter(Boolean)
    .join(' ');
  return `${header}|${ext}`;
}

// The RFC 5424 message for one row: <PRI>1 TIMESTAMP HOST APP MSGID [SD] BODY.
export function formatSyslogMessage(row, { format = 'json', appName = 'plugyard', facility = 16, hostname = syslogHostname() } = {}) {
  const pri = facility * 8 + (SEVERITY[row.outcome] ?? 6);
  const sd = `[plugyard@32473 seq="${sdEscape(row.seq)}" hash="${sdEscape(row.hash)}" outcome="${sdEscape(row.outcome)}"]`;
  const body = format === 'cef' ? cefBody(row) : jsonBody(row);
  return `<${pri}>1 ${new Date(row.at).toISOString()} ${hostname} ${token(appName, 48)} - ${token(row.action, 32)} ${sd} ${body}`;
}

// Octet-counting framing (RFC 6587, section 3.4.1), as used with TCP and TLS syslog (RFC 5425).
export function frameMessage(message) {
  return `${Buffer.byteLength(message, 'utf8')} ${message}`;
}
