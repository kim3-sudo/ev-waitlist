import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { joinQueue } from '../services/queueService.js';
import { tryDispatchZone } from '../services/dispatcher.js';
import { getSettings, validateIdentifiers } from '../services/settingsService.js';

export const zonesRouter = Router();

function serializeZone(zone) {
  const stations = zone.stations.map((station) => ({
    id: station.id,
    name: station.name,
    location: station.location,
    online: registry.isConnected(station.identity),
    connectors: station.connectors
      .filter((c) => c.connectorId > 0)
      .sort((a, b) => a.connectorId - b.connectorId)
      .map((c) => ({ connectorId: c.connectorId, status: c.status })),
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
  res.json(zones.map(serializeZone));
});

zonesRouter.post('/:id/waitlist', async (req, res) => {
  const { name, contact, licensePlate, parkingPermit } = req.body ?? {};
  if (!name || !contact) {
    return res.status(400).json({ error: 'name and contact are required' });
  }

  const settings = await getSettings();
  const identifierError = validateIdentifiers(settings.identifierMode, { licensePlate, parkingPermit });
  if (identifierError) {
    return res.status(400).json({ error: identifierError });
  }

  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  const entry = await joinQueue({ zoneId: zone.id }, { name, contact, licensePlate, parkingPermit });

  // In case a connector somewhere in the zone is already free right now,
  // don't make them wait for the next StatusNotification.
  tryDispatchZone(zone.id).catch((err) => console.error('Zone dispatch on join failed:', err));

  res.status(201).json({ id: entry.id });
});
