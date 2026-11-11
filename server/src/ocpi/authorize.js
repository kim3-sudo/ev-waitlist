import { prisma } from '../db.js';
import { currentRoaming } from '../services/roaming.js';
import { partnerRequest } from './client.js';

// Decides whether a roaming partner's driver token may charge at a station.
//
// Rules:
// - Roaming must be on for the site.
// - A connector held for a waitlisted driver (an ACTIVE reservation at the
//   station) is not given to roaming tokens. Waitlisted drivers keep their place.
// - The token must be known from an active partner and valid, and not NEVER-whitelisted.
// - The partner decides, in real time, through its tokens endpoint, when it offers one.
//   Otherwise the token's whitelist setting decides.
//
// Returns { ok, partnerId } where partnerId names the partner whose token was used.
export async function roamingAuthorize(stationId, uid) {
  const roaming = await currentRoaming();
  if (!roaming.enabled) return { ok: false };

  const held = await prisma.reservation.findFirst({ where: { stationId, status: 'ACTIVE' } });
  if (held) return { ok: false, reason: 'held' };

  const token = await prisma.ocpiToken.findFirst({
    where: { uid, valid: true, partner: { status: 'ACTIVE' } },
    include: { partner: true },
  });
  if (!token || token.whitelist === 'NEVER') return { ok: false };

  const endpoints = JSON.parse(token.partner.endpoints || '{}');
  if (endpoints.tokens) {
    const res = await partnerRequest(
      token.partner,
      'POST',
      `${endpoints.tokens}/${[token.country, token.party, token.uid].map(encodeURIComponent).join('/')}/authorize`,
      { location_id: stationId },
    );
    const allowed = res.ok && res.body?.data?.allowed === 'ALLOWED';
    return allowed ? { ok: true, partnerId: token.partnerId } : { ok: false, reason: 'partner' };
  }

  const allowed = ['ALWAYS', 'ALLOWED', 'ALLOWED_OFFLINE'].includes(token.whitelist);
  return allowed ? { ok: true, partnerId: token.partnerId } : { ok: false, reason: 'whitelist' };
}
