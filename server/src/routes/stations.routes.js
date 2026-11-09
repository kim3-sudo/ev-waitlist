import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { joinQueue } from '../services/queueService.js';
import { tryDispatchStation } from '../services/dispatcher.js';
import { getSettings, resolvePlateRegion, validateIdentifiers } from '../services/settingsService.js';
import { contactProblem, smsChoice } from '../services/notifier.js';
import { roamingWarningError } from '../services/roaming.js';
import { stationNotices } from '../services/notices.js';
import { lockedOut, LOCKOUT_MESSAGE } from '../services/payments/providerOutage.js';

export const stationsRouter = Router();

function serializeStation(station, notices = { alerts: [], pricing: [] }) {
  return {
    id: station.id,
    name: station.name,
    location: station.location,
    vendor: station.vendor,
    model: station.model,
    online: registry.isConnected(station.identity),
    connectors: station.connectors
      .filter((c) => c.connectorId > 0)
      .sort((a, b) => a.connectorId - b.connectorId)
      .map((c) => ({ connectorId: c.connectorId, status: c.status })),
    waitingCount: station.queueEntries.filter((e) => e.status === 'WAITING').length,
    // Alerts and price changes in effect for this charge point now.
    notices,
    // The admin's notes for drivers about this charge point (e.g. where it is).
    tips: station.tips ?? null,
  };
}

stationsRouter.get('/', async (req, res) => {
  const stations = await prisma.station.findMany({
    // Zoned stations are joined as part of their zone (see /api/zones), not
    // individually -- omit them here so the homepage doesn't show a charger
    // twice.
    where: { zoneId: null },
    include: { connectors: true, queueEntries: true },
    orderBy: { name: 'asc' },
  });
  const notices = await stationNotices(stations);
  res.json(stations.map((station) => serializeStation(station, notices.get(station.id))));
});

stationsRouter.get('/:id', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { connectors: true, queueEntries: true },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  const notices = await stationNotices([station]);
  res.json(serializeStation(station, notices.get(station.id)));
});

stationsRouter.post('/:id/waitlist', async (req, res) => {
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

  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  if (station.zoneId) {
    return res.status(400).json({ error: 'This charger is part of a zone -- join the zone waitlist instead' });
  }

  const roamingError = await roamingWarningError(req.body);
  if (roamingError) return res.status(roamingError.status).json(roamingError.body);

  if (await lockedOut()) return res.status(503).json({ error: LOCKOUT_MESSAGE });

  const entry = await joinQueue(
    { stationId: station.id },
    { name, contact, smsNumber: sms.smsNumber, licensePlate, parkingPermit, plateRegion: regionResult.plateRegion },
  );

  // In case a connector is already free right now, don't make them wait for
  // the next StatusNotification. Awaited, so the reply says whether they are
  // already NOTIFIED and can start charging straight away.
  await tryDispatchStation(station.id).catch((err) => console.error('Dispatch on join failed:', err));
  const current = await prisma.queueEntry.findUnique({ where: { id: entry.id }, select: { status: true } });

  res.status(201).json({ id: entry.id, status: current?.status ?? entry.status });
});
