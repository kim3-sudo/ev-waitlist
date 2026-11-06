import { decryptSecret } from '../utils/secretBox.js';
import { encodeForHeader } from './tokens.js';

const TIMEOUT_MS = 10_000;

// Calls a partner's OCPI API with the token they issued us. Returns { ok, status, body }.
// Never throws for an HTTP error; network failures come back as ok: false with status 0.
export async function partnerRequest(theirToken, method, url, body) {
  const headers = { Authorization: `Token ${encodeForHeader(theirToken)}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err.message };
  }
}

// The plain token we use to call a partner, from its encrypted form.
export function theirTokenOf(partner) {
  return partner.theirTokenEnc ? decryptSecret(partner.theirTokenEnc) : null;
}

// Reads a partner's version list and the endpoints for OCPI 2.2.1, to learn where
// to send data. Returns { ok, endpoints } or { ok: false, error }.
export async function discoverEndpoints(versionsUrl, theirToken) {
  const versions = await partnerRequest(theirToken, 'GET', versionsUrl);
  if (!versions.ok || !Array.isArray(versions.body?.data)) {
    return { ok: false, error: `The partner's version list could not be read (HTTP ${versions.status})` };
  }
  const v221 = versions.body.data.find((v) => v.version === '2.2.1');
  if (!v221?.url) return { ok: false, error: 'The partner does not offer OCPI 2.2.1' };

  const details = await partnerRequest(theirToken, 'GET', v221.url);
  if (!details.ok || !Array.isArray(details.body?.data?.endpoints)) {
    return { ok: false, error: `The partner's 2.2.1 endpoints could not be read (HTTP ${details.status})` };
  }
  const endpoints = {};
  for (const e of details.body.data.endpoints) {
    if (e?.identifier && e?.url) endpoints[e.identifier] = e.url;
  }
  return { ok: true, endpoints };
}
