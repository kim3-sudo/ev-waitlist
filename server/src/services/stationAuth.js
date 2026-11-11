import crypto from 'node:crypto';

// Charge points prove who they are with a connection key: the Basic-auth password of the OCPP
// websocket handshake (OCPP 1.6 security profile 1; use wss:// so it is encrypted in transit).
// The key is 24 random bytes, shown once when it is made. Only its SHA-256 is stored. The key has
// enough randomness that a plain hash is safe; there is nothing to brute-force.

export function newStationKey() {
  const key = crypto.randomBytes(24).toString('base64url');
  return { key, hash: hashStationKey(key) };
}

export function hashStationKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Whether the password a charge point sent matches the stored hash. `password` is a Buffer or
// undefined (ocpp-rpc leaves it undefined when the header is missing or names another identity).
export function stationKeyMatches(storedHash, password) {
  if (!storedHash || !password || password.length === 0) return false;
  const given = Buffer.from(hashStationKey(password), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Charge points set up before keys existed have none. They may connect without one unless the
// operator sets OCPP_REQUIRE_AUTH=1 (read per call, so tests and operators can change it).
export function keylessAllowed() {
  return process.env.OCPP_REQUIRE_AUTH !== '1';
}
