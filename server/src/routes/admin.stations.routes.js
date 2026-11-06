import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { enqueueForActivePartners } from '../ocpi/outbox.js';
import { CONNECTOR_STANDARDS, CONNECTOR_FORMATS, POWER_TYPES } from '../ocpi/mappers.js';

export const adminStationsRouter = Router();

function serialize(station) {
  return {
    id: station.id,
    identity: station.identity,
    name: station.name,
    vendor: station.vendor,
    model: station.model,
    location: station.location,
    latitude: station.latitude,
    longitude: station.longitude,
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

// Connector details published to roaming partners. Each entry names a connector on
// this charge point. Blank values clear a detail.
function connectorDetailsError(list, allowedIds) {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'connectors must be a list';
  for (const c of list) {
    if (!allowedIds.has(Number(c?.connectorId))) return `connector ${c?.connectorId} does not exist on this charge point`;
    if (c.standard && !CONNECTOR_STANDARDS.includes(c.standard)) return `standard "${c.standard}" is not a valid connector standard`;
    if (c.format && !CONNECTOR_FORMATS.includes(c.format)) return `format "${c.format}" must be CABLE or SOCKET`;
    if (c.powerType && !POWER_TYPES.includes(c.powerType)) return `powerType "${c.powerType}" is not valid`;
    for (const key of ['maxVoltage', 'maxAmperage']) {
      const v = c[key];
      if (v === '' || v == null) continue;
      if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 1000) return `${key} must be a whole number from 1 to 1000`;
    }
  }
  return null;
}

async function applyConnectorDetails(stationId, list) {
  if (!list) return;
  for (const c of list) {
    const blank = (v) => v === '' || v == null;
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId, connectorId: Number(c.connectorId) } },
      data: {
        standard: blank(c.standard) ? null : c.standard,
        format: blank(c.format) ? null : c.format,
        powerType: blank(c.powerType) ? null : c.powerType,
        maxVoltage: blank(c.maxVoltage) ? null : Number(c.maxVoltage),
        maxAmperage: blank(c.maxAmperage) ? null : Number(c.maxAmperage),
      },
    });
  }
}

// The identity is part of the websocket URL (ws://host/ocpp/<identity>), so it
// is limited to characters that are safe in a URL path segment.
const IDENTITY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function identityError(identity) {
  if (typeof identity !== 'string' || !identity.trim()) return 'The OCPP identity is required';
  if (!IDENTITY_PATTERN.test(identity)) {
    return 'Use 1-64 letters, digits, or the characters . _ : - (no spaces or slashes)';
  }
  return null;
}

// Coordinates are optional. A station with coordinates is published to roaming partners.
function coordinatesError(latitude, longitude) {
  const lat = latitude === '' ? null : latitude;
  const lon = longitude === '' ? null : longitude;
  if ((lat == null) !== (lon == null)) return 'Give both latitude and longitude, or neither';
  if (lat == null) return null;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'latitude must be a number from -90 to 90';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'longitude must be a number from -180 to 180';
  return null;
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

// Used by the add-charge-point wizard to check an identity before creating the station.
adminStationsRouter.get('/identity-check', async (req, res) => {
  const identity = typeof req.query.identity === 'string' ? req.query.identity.trim() : '';
  const error = identityError(identity);
  if (error) return res.json({ available: false, error });
  const existing = await prisma.station.findUnique({ where: { identity } });
  if (existing) {
    return res.json({ available: false, error: `A charge point with identity "${identity}" already exists` });
  }
  res.json({ available: true, error: null });
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
  const { identity, name, vendor, model, location, connectorCount, zoneId, latitude, longitude, connectors } = req.body ?? {};
  const coordsProblem = coordinatesError(latitude, longitude);
  if (coordsProblem) return res.status(400).json({ error: coordsProblem });
  const newCount = Math.max(0, Number(connectorCount) || 1);
  const detailsProblem = connectorDetailsError(connectors, new Set(Array.from({ length: newCount }, (_, i) => i + 1)));
  if (detailsProblem) return res.status(400).json({ error: detailsProblem });
  if (!identity || !name) {
    return res.status(400).json({ error: 'identity and name are required' });
  }
  const problem = identityError(identity);
  if (problem) return res.status(400).json({ error: problem });

  const existing = await prisma.station.findUnique({ where: { identity } });
  if (existing) {
    return res.status(409).json({ error: `A station with identity "${identity}" already exists` });
  }

  const resolvedZone = await resolveZoneId(zoneId);
  if (resolvedZone.error) return res.status(400).json({ error: resolvedZone.error });

  const station = await prisma.station.create({
    data: {
      identity,
      name,
      vendor,
      model,
      location,
      zoneId: resolvedZone.zoneId,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    },
  });

  await syncConnectorCount(station.id, newCount);
  await applyConnectorDetails(station.id, connectors);
  if (latitude != null) await enqueueForActivePartners('LOCATION', station.id);

  const withConnectors = await prisma.station.findUnique({
    where: { id: station.id },
    include: { connectors: true, zone: true },
  });
  res.status(201).json(serialize(withConnectors));
});

adminStationsRouter.put('/:id', async (req, res) => {
  const { identity, name, vendor, model, location, connectorCount, zoneId, latitude, longitude, connectors } = req.body ?? {};
  const coordsProblem = coordinatesError(latitude, longitude);
  if (coordsProblem) return res.status(400).json({ error: coordsProblem });

  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  // The connectors that will exist after this save: 1..connectorCount if it is given, else the current ones.
  const existing = await prisma.connector.findMany({ where: { stationId: station.id, connectorId: { gt: 0 } } });
  const willExist = connectorCount != null
    ? new Set(Array.from({ length: Math.max(0, Number(connectorCount)) }, (_, i) => i + 1))
    : new Set(existing.map((c) => c.connectorId));
  const detailsProblem = connectorDetailsError(connectors, willExist);
  if (detailsProblem) return res.status(400).json({ error: detailsProblem });

  if (identity && identity !== station.identity) {
    const problem = identityError(identity);
    if (problem) return res.status(400).json({ error: problem });
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
      ...(latitude !== undefined && { latitude: latitude === '' ? null : latitude }),
      ...(longitude !== undefined && { longitude: longitude === '' ? null : longitude }),
    },
  });

  if (connectorCount != null) {
    await syncConnectorCount(station.id, Math.max(0, Number(connectorCount)));
  }
  await applyConnectorDetails(station.id, connectors);
  await enqueueForActivePartners('LOCATION', station.id);

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
