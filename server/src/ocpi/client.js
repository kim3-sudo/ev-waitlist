import { decryptSecret } from '../utils/secretBox.js';
import { encodeForHeader } from './tokens.js';
import { safeRequest, urlProblem } from '../utils/safeHttp.js';

const TIMEOUT_MS = 10_000;
const MAX_REPLY_BYTES = 2_000_000;

// Partners are outside parties, and every address they give us is untrusted. Their address is
// called only if all of this holds (see utils/safeHttp.js for the network part):
//   - it is https, and does not resolve to a private or reserved address;
//   - it is on the same origin as the versions address the partner registered with. Our token
//     for that partner is only ever sent to the host the partner itself registered, so a partner
//     cannot make us send it elsewhere;
//   - redirects are not followed.
// OCPI_ALLOW_PRIVATE_NETWORKS=1 allows http and private addresses, for partners on a private network.
const allowPrivate = () => process.env.OCPI_ALLOW_PRIVATE_NETWORKS === '1';

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Why `url` may not be called for a partner whose registered versions address is `versionsUrl`.
export function partnerUrlProblem(versionsUrl, url) {
  const problem = urlProblem(url, { allowPrivate: allowPrivate() });
  if (problem) return problem;
  if (!versionsUrl || originOf(url) !== originOf(versionsUrl)) {
    return 'The address is not on the same host as the one the partner registered with';
  }
  return null;
}

async function send(theirToken, method, url, body) {
  const headers = { Authorization: `Token ${encodeForHeader(theirToken)}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await safeRequest(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_REPLY_BYTES,
      allowPrivate: allowPrivate(),
    });
    let parsed = null;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      parsed = null;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err.message };
  }
}

// Calls a partner's OCPI API with the token they issued us. `partner` is the OcpiPartner row.
// Returns { ok, status, body }. Never throws for an HTTP error; a refused address or a network
// failure comes back as ok: false with status 0.
export async function partnerRequest(partner, method, url, body) {
  const problem = partnerUrlProblem(partner.theirVersionsUrl, url);
  if (problem) return { ok: false, status: 0, body: null, error: problem };
  return send(theirTokenOf(partner), method, url, body);
}

// The plain token we use to call a partner, from its encrypted form.
export function theirTokenOf(partner) {
  return partner.theirTokenEnc ? decryptSecret(partner.theirTokenEnc) : null;
}

// Reads a partner's version list and the endpoints for OCPI 2.2.1, to learn where
// to send data. Returns { ok, endpoints } or { ok: false, error }.
export async function discoverEndpoints(versionsUrl, theirToken) {
  // The partner registers with this address, and everything it lists must be on the same host.
  const first = partnerUrlProblem(versionsUrl, versionsUrl);
  if (first) return { ok: false, error: `The partner's address was refused: ${first}` };

  const versions = await send(theirToken, 'GET', versionsUrl);
  if (!versions.ok || !Array.isArray(versions.body?.data)) {
    return { ok: false, error: `The partner's version list could not be read (HTTP ${versions.status})` };
  }
  const v221 = versions.body.data.find((v) => v.version === '2.2.1');
  if (!v221?.url) return { ok: false, error: 'The partner does not offer OCPI 2.2.1' };
  const versionProblem = partnerUrlProblem(versionsUrl, v221.url);
  if (versionProblem) return { ok: false, error: `The partner's 2.2.1 address was refused: ${versionProblem}` };

  const details = await send(theirToken, 'GET', v221.url);
  if (!details.ok || !Array.isArray(details.body?.data?.endpoints)) {
    return { ok: false, error: `The partner's 2.2.1 endpoints could not be read (HTTP ${details.status})` };
  }
  const endpoints = {};
  for (const e of details.body.data.endpoints) {
    if (!e?.identifier || !e?.url) continue;
    const problem = partnerUrlProblem(versionsUrl, e.url);
    if (problem) return { ok: false, error: `The partner's "${e.identifier}" address was refused: ${problem}` };
    endpoints[e.identifier] = e.url;
  }
  return { ok: true, endpoints };
}
