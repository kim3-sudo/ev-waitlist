import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';

export const adminStationsRouter = Router();

function serialize(station) {
  return {
    id: station.id,
    identity: station.identity,
    name: station.name,
    vendor: station.vendor,
    model: station.model,
    location: station.location,
    zoneId: station.zoneId,
    zoneName: station.zone?.name ?? null,
    online: registry.isConnected(station.identity),
    connectors: station.connectors
      .filter((c) => c.connectorId > 0)
      .sort((a, b) => a.connectorId - b.connectorId),
    createdAt: station.createdAt,
    updatedAt: station.updatedAt,
  };
}

// Creates/removes Connector rows so the station has exactly `count`
// connectors numbered 1..count. Existing rows (and their status/history)
// are left untouched.
async function syncConnectorCount(stationId, count) {
  const existing = await prisma.connector.findMany({ where: { stationId, connectorId: { gt: 0 } } });
  const existingIds = new Set(existing.map((c) => c.connectorId));

  const toCreate = [];
  for (let i = 1; i <= count; i += 1) {
    if (!existingIds.has(i)) toCreate.push({ stationId, connectorId: i, status: 'Unavailable' });
  }
  if (toCreate.length) {
    await prisma.connector.createMany({ data: toCreate });
  }

  await prisma.connector.deleteMany({ where: { stationId, connectorId: { gt: count } } });
}

async function resolveZoneId(zoneId) {
  if (!zoneId) return { zoneId: null };
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) return { error: 'Zone not found' };
  return { zoneId: zone.id };
}

adminStationsRouter.get('/', async (req, res) => {
  const stations = await prisma.station.findMany({
    include: { connectors: true, zone: true },
    orderBy: { name: 'asc' },
  });
  res.json(stations.map(serialize));
});

adminStationsRouter.get('/:id', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { connectors: true, zone: true },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json(serialize(station));
});

adminStationsRouter.post('/', async (req, res) => {
  const { identity, name, vendor, model, location, connectorCount, zoneId } = req.body ?? {};
  if (!identity || !name) {
    return res.status(400).json({ error: 'identity and name are required' });
  }

  const existing = await prisma.station.findUnique({ where: { identity } });
  if (existing) {
    return res.status(409).json({ error: `A station with identity "${identity}" already exists` });
  }

  const resolvedZone = await resolveZoneId(zoneId);
  if (resolvedZone.error) return res.status(400).json({ error: resolvedZone.error });

  const station = await prisma.station.create({
    data: { identity, name, vendor, model, location, zoneId: resolvedZone.zoneId },
  });

  await syncConnectorCount(station.id, Math.max(0, Number(connectorCount) || 1));

  const withConnectors = await prisma.station.findUnique({
    where: { id: station.id },
    include: { connectors: true, zone: true },
  });
  res.status(201).json(serialize(withConnectors));
});

adminStationsRouter.put('/:id', async (req, res) => {
  const { identity, name, vendor, model, location, connectorCount, zoneId } = req.body ?? {};

  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Station not found' });

  if (identity && identity !== station.identity) {
    const clash = await prisma.station.findUnique({ where: { identity } });
    if (clash) {
      return res.status(409).json({ error: `A station with identity "${identity}" already exists` });
    }
  }

  const resolvedZone = await resolveZoneId(zoneId);
  if (resolvedZone.error) return res.status(400).json({ error: resolvedZone.error });

  await prisma.station.update({
    where: { id: station.id },
    data: {
      identity: identity ?? station.identity,
      name: name ?? station.name,
      vendor,
      model,
      location,
      zoneId: resolvedZone.zoneId,
    },
  });

  if (connectorCount != null) {
    await syncConnectorCount(station.id, Math.max(0, Number(connectorCount)));
  }

  const updated = await prisma.station.findUnique({
    where: { id: station.id },
    include: { connectors: true, zone: true },
  });
  res.json(serialize(updated));
});

adminStationsRouter.delete('/:id', async (req, res) => {
  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Station not found' });

  await prisma.station.delete({ where: { id: station.id } });
  res.status(204).send();
});
