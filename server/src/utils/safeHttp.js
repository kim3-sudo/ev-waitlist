import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Outbound HTTP to addresses an administrator or a partner gave us (webhook endpoints, OCPI
// partners). Those addresses must not lead into this server's own network (SSRF), so:
//   - the name is resolved here, every address it resolves to is checked, and the connection is
//     made to the address that was checked. A name that answers differently a second time (DNS
//     rebinding) cannot change where the request goes;
//   - redirects are never followed;
//   - the reply is cut off at a size limit and the whole call has a time limit.
// `allowPrivate` is for operators who really do run the other end on a private network.

const BLOCKED = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata services
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
]) BLOCKED.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
]) BLOCKED.addSubnet(net6, bits, 'ipv6');

// The IPv4 address hidden inside an IPv6 one (IPv4-mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96,
// 6to4 2002::/16), as 'a.b.c.d'. Null when there is none.
function embeddedIPv4(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return null;
  const quad = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return quad(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return quad(g6, g7);
  if (g0 === 0x2002) return quad(g1, g2);
  // Deprecated IPv4-compatible form ::a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && (g6 !== 0 || g7 > 1)) return quad(g6, g7);
  return null;
}

// Eight 16-bit numbers, or null if this is not an IPv6 address.
function expandIPv6(ip) {
  if (!net.isIPv6(ip)) return null;
  let text = ip.split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail[1].split('.').map(Number);
    text = text.replace(tail[1], `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`);
  }
  const [head, rest] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - first.length - last.length).fill('0');
  const groups = [...first, ...fill, ...last].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

// Why an IP address may not be called, or null if it may.
export function addressProblem(ip) {
  const version = net.isIP(ip);
  if (!version) return 'not an IP address';
  if (BLOCKED.check(ip, version === 4 ? 'ipv4' : 'ipv6')) return 'on a private or reserved network';
  if (version === 6) {
    const inner = embeddedIPv4(ip);
    if (inner && BLOCKED.check(inner, 'ipv4')) return 'on a private or reserved network';
  }
  return null;
}

// Checks a web address before anything is sent. Returns an error message, or null.
export function urlProblem(value, { allowPrivate = false } = {}) {
  let u;
  try {
    u = new URL(String(value ?? ''));
  } catch {
    return 'Enter a full web address, starting with https://';
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivate)) return 'The address must start with https://';
  if (u.username || u.password) return 'The address must not contain a user name or password';
  if (allowPrivate) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'The address must not be on this machine or a local network';
  }
  if (net.isIP(host) && addressProblem(host)) return 'The address must not be on a private network';
  return null;
}

// A dns.lookup that refuses names resolving to a blocked address. Node connects to what this returns.
function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => !allowPrivate && addressProblem(a.address));
      if (bad) {
        return callback(Object.assign(new Error(`${hostname} resolves to ${bad.address}, which is ${addressProblem(bad.address)}`), { code: 'EBLOCKEDADDRESS' }));
      }
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// Sends one request. Resolves to { status, headers, body } (body as text, cut at maxBytes).
// Rejects for a refused address, a network failure, a timeout, or a reply that is too big.
// A redirect is returned as it is (status 3xx), never followed.
export async function safeRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 1_000_000, allowPrivate = false } = {}) {
  const problem = urlProblem(url, { allowPrivate });
  if (problem) throw Object.assign(new Error(problem), { code: 'EBLOCKEDADDRESS' });
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;
  const literal = u.hostname.replace(/^\[|\]$/g, '');

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = client.request(
      {
        protocol: u.protocol,
        hostname: literal,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method,
        headers: { ...headers, ...(payload ? { 'Content-Length': String(payload.length) } : {}) },
        lookup: guardedLookup(allowPrivate),
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            settle(reject, Object.assign(new Error('The reply was too large'), { code: 'ETOOBIG' }));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => settle(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => settle(reject, err));
        res.on('close', () => settle(reject, new Error('The connection closed before the reply was complete')));
      },
    );
    req.on('timeout', () => {
      settle(reject, Object.assign(new Error('The server did not answer in time'), { name: 'TimeoutError', code: 'ETIMEDOUT' }));
      req.destroy();
    });
    req.on('error', (err) => settle(reject, err));
    if (payload) req.write(payload);
    req.end();
  });
}
