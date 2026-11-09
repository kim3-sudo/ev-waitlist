import crypto from 'node:crypto';
import { prisma } from '../../db.js';

// A wallet tag is 12 hex characters. That fits OCPP's 20-character idTag and Apple's 64-byte
// NFC message. Tags are unique within a site and are never reused, even after revocation.
export function newWalletTag() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

// Returns the account's live credential, creating one the first time it is asked for.
// Must run inside a site (runWithTenant or a request), like the rest of the scoped client.
export async function ensureCredential(accountId) {
  const existing = await prisma.walletCredential.findFirst({ where: { accountId, revokedAt: null } });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.walletCredential.create({ data: { accountId, idTag: newWalletTag() } });
    } catch (err) {
      // P2002 is a unique clash on the tag. Try a fresh one.
      if (err.code !== 'P2002') throw err;
    }
  }
  throw new Error('Could not create a wallet credential');
}

// Revokes every live credential the account holds. Their tags stop working at once in this
// server, and the caller should clear the charge points' caches (clearCacheEverywhere) so a
// charge point that has the tag cached stops accepting it too. Returns how many were revoked.
export async function revokeCredentials(accountId, at = new Date()) {
  const { count } = await prisma.walletCredential.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: at },
  });
  return count;
}

// Turns a tag from a charge point into the tag the waitlist knows about.
//
// - A wallet tag whose account is due to charge at this station (a NOTIFIED entry with an
//   ACTIVE reservation) becomes that entry's tag. The existing checks then run unchanged,
//   and the transaction records the entry's tag. The reservation's expiry is returned too, so the
//   charge point can stop accepting the tag once the turn is over.
// - Any other tag is returned unchanged. A wallet tag that is not due here stays unknown to the
//   waitlist, so the existing checks refuse it.
export async function translateIdTag(stationId, tag) {
  if (!tag) return { idTag: tag };

  const credential = await prisma.walletCredential.findFirst({ where: { idTag: tag, revokedAt: null } });
  if (!credential) return { idTag: tag };

  // Passes only work at charge points whose reader an admin has flagged for wallet passes.
  const station = await prisma.station.findUnique({ where: { id: stationId }, select: { walletTap: true } });
  if (!station?.walletTap) return { idTag: tag };

  const entry = await prisma.queueEntry.findFirst({
    where: {
      stationId,
      accountId: credential.accountId,
      status: 'NOTIFIED',
      reservation: { status: 'ACTIVE' },
    },
    include: { reservation: true },
  });
  if (!entry) return { idTag: tag };

  return { idTag: entry.idTag, expiresAt: entry.reservation.expiresAt };
}

// Retention: revokes credentials that have gone unused. A credential is revoked when it was
// issued before the cutoff and its account has no open waitlist entry and no entry closed since
// the cutoff. Returns how many were revoked.
export async function revokeStaleCredentials(cutoff, now = new Date()) {
  const candidates = await prisma.walletCredential.findMany({
    where: { revokedAt: null, issuedAt: { lt: cutoff } },
    select: { id: true, accountId: true },
  });
  let revoked = 0;
  for (const candidate of candidates) {
    const recent = await prisma.queueEntry.count({
      where: { accountId: candidate.accountId, OR: [{ closedAt: null }, { closedAt: { gte: cutoff } }] },
    });
    if (recent === 0) {
      await prisma.walletCredential.update({ where: { id: candidate.id }, data: { revokedAt: now } });
      revoked += 1;
    }
  }
  return revoked;
}
