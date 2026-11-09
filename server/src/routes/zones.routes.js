import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { joinQueue } from '../services/queueService.js';
import { tryDispatchZone } from '../services/dispatcher.js';
import { getSettings, resolvePlateRegion, validateIdentifiers } from '../services/settingsService.js';
import { contactProblem, smsChoice } from '../services/notifier.js';
import { roamingWarningError } from '../services/roaming.js';
import { stationNotices } from '../services/notices.js';
import { lockedOut, LOCKOUT_MESSAGE } from '../services/payments/providerOutage.js';

export const zonesRouter = Router();

function serializeZone(zone, notices) {
  const stations = zone.stations.map((station) => ({
    id: station.id,
    name: station.name,
    location: station.location,
    online: registry.isConnected(station.identity),
    connectors: station.connectors
      .filter((c) => c.connectorId > 0)
      .sort((a, b) => a.connectorId - b.connectorId)
      .map((c) => ({ connectorId: c.connectorId, status: c.status })),
    notices: notices.get(station.id) ?? { alerts: [], pricing: [] },
    tips: station.tips ?? null,
  }));

  return {
    id: zone.id,
    name: zone.name,
    stations,
    waitingCount: zone._count.queueEntries,
  };
}

zonesRouter.get('/', async (req, res) => {
  const zones = await prisma.zone.findMany({
    include: {
      stations: { include: { connectors: true }, orderBy: { name: 'asc' } },
      _count: { select: { queueEntries: { where: { status: 'WAITING' } } } },
    },
    orderBy: { name: 'asc' },
  });
  const notices = await stationNotices(zones.flatMap((zone) => zone.stations));
  res.json(zones.map((zone) => serializeZone(zone, notices)));
});

zonesRouter.post('/:id/waitlist', async (req, res) => {
  const { name, contact, licensePlate, parkingPermit, plateRegion } = req.body ?? {};
  const sms = smsChoice(req.body?.smsNumber);
  if (sms.error) return res.status(400).json({ error: sms.error });
  const contactError = contactProblem(contact);
  if (contactError) return res.status(400).json({ error: contactError });
  if (!name || !contact) {
    return res.status(400).json({ error: 'name and contact are required' });
  }

  const settings = await getSettings();
  const identifierError = validateIdentifiers(settings.identifierMode, { licensePlate, parkingPermit });
  if (identifierError) {
    return res.status(400).json({ error: identifierError });
  }
  const regionResult = await resolvePlateRegion(plateRegion, Boolean(licensePlate?.trim()));
  if (regionResult.error) return res.status(400).json({ error: regionResult.error });

  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  const roamingError = await roamingWarningError(req.body);
  if (roamingError) return res.status(roamingError.status).json(roamingError.body);

  if (await lockedOut()) return res.status(503).json({ error: LOCKOUT_MESSAGE });

  const entry = await joinQueue(
    { zoneId: zone.id },
    { name, contact, smsNumber: sms.smsNumber, licensePlate, parkingPermit, plateRegion: regionResult.plateRegion },
  );

  // In case a connector somewhere in the zone is already free right now,
  // don't make them wait for the next StatusNotification. Awaited, so the reply
  // says whether they are already NOTIFIED and can start charging straight away.
  await tryDispatchZone(zone.id).catch((err) => console.error('Zone dispatch on join failed:', err));
  const current = await prisma.queueEntry.findUnique({ where: { id: entry.id }, select: { status: true } });

  res.status(201).json({ id: entry.id, status: current?.status ?? entry.status });
});
