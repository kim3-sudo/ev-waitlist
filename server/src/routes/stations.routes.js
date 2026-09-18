import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { joinQueue } from '../services/queueService.js';
import { tryDispatchStation } from '../services/dispatcher.js';
import { getSettings, validateIdentifiers } from '../services/settingsService.js';

export const stationsRouter = Router();

function serializeStation(station) {
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
  res.json(stations.map(serializeStation));
});

stationsRouter.get('/:id', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { connectors: true, queueEntries: true },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json(serializeStation(station));
});

stationsRouter.post('/:id/waitlist', async (req, res) => {
  const { name, contact, licensePlate, parkingPermit } = req.body ?? {};
  if (!name || !contact) {
    return res.status(400).json({ error: 'name and contact are required' });
  }

  const settings = await getSettings();
  const identifierError = validateIdentifiers(settings.identifierMode, { licensePlate, parkingPermit });
  if (identifierError) {
    return res.status(400).json({ error: identifierError });
  }

  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  if (station.zoneId) {
    return res.status(400).json({ error: 'This charger is part of a zone -- join the zone waitlist instead' });
  }

  const entry = await joinQueue({ stationId: station.id }, { name, contact, licensePlate, parkingPermit });

  // In case a connector is already free right now, don't make them wait for
  // the next StatusNotification.
  tryDispatchStation(station.id).catch((err) => console.error('Dispatch on join failed:', err));

  res.status(201).json({ id: entry.id });
});
