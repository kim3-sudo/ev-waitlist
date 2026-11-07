import { prisma, rawPrisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { getPaymentSettings } from '../services/payments/paymentSettingsService.js';
import { priceAdjusterForSession } from '../services/payments/priceRuleService.js';
import { partnerRequest, theirTokenOf } from './client.js';
import { locationOf, tariffOf, sessionOf, cdrOf, evseStatusOf, evseUid, stationIsPublishable, TARIFF_ID } from './mappers.js';

// Messages to roaming partners. Each row names what to send (kind + refId); the
// body is built from the database when the row is sent, so it is always current.

export const KINDS = ['LOCATION', 'EVSE_STATUS', 'TARIFFS', 'SESSION', 'CDR'];
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

// Queues a message for one partner. A duplicate that is still pending is not added twice.
export async function enqueue(partnerId, kind, refId) {
  const pending = await prisma.ocpiOutbox.findFirst({ where: { partnerId, kind, refId, status: 'PENDING' } });
  if (pending) return pending;
  // The due time is set here, not by the database default: database timestamps are
  // rounded to the millisecond, and a row could otherwise read as due a moment later.
  return prisma.ocpiOutbox.create({ data: { partnerId, kind, refId, nextAttemptAt: new Date() } });
}

// Queues a message for every active partner of the current site. A location is
// only sent for a station that has coordinates.
export async function enqueueForActivePartners(kind, refId) {
  if (kind === 'LOCATION' || kind === 'EVSE_STATUS') {
    const stationId = kind === 'LOCATION' ? refId : refId.split('|')[0];
    const station = await prisma.station.findUnique({ where: { id: stationId }, include: { connectors: true } });
    if (!station || !stationIsPublishable(station)) return;
  }
  const partners = await prisma.ocpiPartner.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  for (const p of partners) await enqueue(p.id, kind, refId);
}

async function operatorOrNull() {
  const op = await rawPrisma.operator.findUnique({ where: { id: 'singleton' } });
  return op?.countryCode && op?.partyId ? op : null;
}

// Works out the request for one outbox row. Returns { method, url, body } or { skip: reason }.
async function buildRequest(row, endpoints) {
  const operator = await operatorOrNull();
  if (!operator) return { skip: 'The operator party (country code and party ID) is not set' };
  const cc = operator.countryCode;
  const pid = operator.partyId;

  switch (row.kind) {
    case 'LOCATION': {
      const station = await prisma.station.findUnique({ where: { id: row.refId }, include: { connectors: true } });
      if (!station || !stationIsPublishable(station)) return { skip: 'Station is not published (coordinates or connector details missing)' };
      if (!endpoints.locations) return { skip: 'The partner does not accept locations' };
      return {
        method: 'PUT',
        url: `${endpoints.locations}/${cc}/${pid}/${station.id}`,
        body: locationOf(operator, station),
      };
    }
    case 'EVSE_STATUS': {
      const [stationId, connectorId] = row.refId.split('|');
      const station = await prisma.station.findUnique({ where: { id: stationId }, include: { connectors: true } });
      const connector = station?.connectors.find((c) => String(c.connectorId) === connectorId);
      if (!station || !connector || !stationIsPublishable(station)) return { skip: 'Station is not published (coordinates or connector details missing)' };
      if (!endpoints.locations) return { skip: 'The partner does not accept locations' };
      return {
        method: 'PATCH',
        url: `${endpoints.locations}/${cc}/${pid}/${station.id}/${evseUid(station, connector.connectorId)}`,
        body: evseStatusOf(station, connector),
      };
    }
    case 'TARIFFS': {
      if (!endpoints.tariffs) return { skip: 'The partner does not accept tariffs' };
      const settings = await getPaymentSettings();
      return { method: 'PUT', url: `${endpoints.tariffs}/${cc}/${pid}/${TARIFF_ID}`, body: tariffOf(operator, settings) };
    }
    case 'SESSION': {
      if (!endpoints.sessions) return { skip: 'The partner does not accept sessions' };
      const tx = await prisma.transaction.findUnique({ where: { id: row.refId }, include: { station: { include: { connectors: true } } } });
      if (!tx || tx.partnerId !== row.partnerId) return { skip: 'Session is not for this partner' };
      const token = await prisma.ocpiToken.findFirst({ where: { partnerId: row.partnerId, uid: tx.idTag } });
      const settings = await getPaymentSettings();
      return {
        method: 'PUT',
        url: `${endpoints.sessions}/${cc}/${pid}/${tx.id}`,
        body: sessionOf(operator, tx.station, tx, token, settings),
      };
    }
    case 'CDR': {
      if (!endpoints.cdrs) return { skip: 'The partner does not accept CDRs' };
      const tx = await prisma.transaction.findUnique({ where: { id: row.refId }, include: { station: { include: { connectors: true } } } });
      if (!tx || tx.partnerId !== row.partnerId || !tx.stoppedAt) return { skip: 'Session is not finished for this partner' };
      const token = await prisma.ocpiToken.findFirst({ where: { partnerId: row.partnerId, uid: tx.idTag } });
      const settings = await getPaymentSettings();
      const adjustmentAt = await priceAdjusterForSession({
        tenantId: tx.tenantId,
        stationId: tx.stationId,
        zoneId: tx.station.zoneId,
        connectorId: tx.connectorId,
        startedAt: tx.startedAt,
        stoppedAt: tx.stoppedAt,
      });
      return { method: 'POST', url: endpoints.cdrs, body: cdrOf(operator, tx.station, tx, token, settings, adjustmentAt) };
    }
    default:
      return { skip: `Unknown message kind ${row.kind}` };
  }
}

function backoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

// Sends the due messages of the current site. Returns how many were sent successfully.
export async function dispatchDue(now = new Date(), limit = 50) {
  const rows = await prisma.ocpiOutbox.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    include: { partner: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let sent = 0;
  for (const row of rows) {
    const partner = row.partner;
    if (partner.status !== 'ACTIVE') {
      await prisma.ocpiOutbox.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: 'Partner is not active' } });
      continue;
    }

    const endpoints = JSON.parse(partner.endpoints || '{}');
    const request = await buildRequest(row, endpoints);
    if (request.skip) {
      await prisma.ocpiOutbox.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: request.skip } });
      continue;
    }

    const theirToken = theirTokenOf(partner);
    const res = await partnerRequest(theirToken, request.method, request.url, request.body);
    if (res.ok) {
      await prisma.ocpiOutbox.update({ where: { id: row.id }, data: { status: 'DONE', lastError: null } });
      sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    const reason = res.error ? `Network error: ${res.error}` : `Partner answered HTTP ${res.status}`;
    await prisma.ocpiOutbox.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: reason,
        status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
      },
    });
  }
  return sent;
}

// Sends the due messages of every site every 15 seconds.
export function startOcpiDispatcher() {
  return setInterval(() => {
    dispatchAllTenants().catch((err) => console.error('OCPI dispatch failed:', err));
  }, 15_000);
}

// Sends the due messages of every site. Run on a timer.
export async function dispatchAllTenants() {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    await runWithTenant(tenant.id, () => dispatchDue()).catch((err) =>
      console.error(`OCPI dispatch failed for site ${tenant.id}:`, err),
    );
  }
}

