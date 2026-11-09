import { readPageRequest, afterPosition, pageOf } from '../pagination.js';
import { Router } from 'express';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { enqueueForActivePartners } from '../ocpi/outbox.js';
import { CONNECTOR_STANDARDS, CONNECTOR_FORMATS, POWER_TYPES, powerTypeAllowed } from '../ocpi/mappers.js';
import { latestReadings } from '../services/meterService.js';
import { cleanText, coordinatesProblem, locatorTextFields } from '../services/locator.js';
import { normalizeParkingKeys, readParkingKeys } from '../services/siteFeatures.js';

export const adminStationsRouter = Router();

// Longest note an admin can write for drivers about a charge point.
const TIPS_MAX = 500;

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
    city: station.city,
    postalCode: station.postalCode,
    country: station.country,
    hours: station.hours,
    amenities: station.amenities,
    tips: station.tips ?? null,
    parkingKeys: readParkingKeys(station.parkingKeys),
    zoneId: station.zoneId,
    zoneName: station.zone?.name ?? null,
    walletTap: Boolean(station.walletTap),
    smartChargingEnabled: Boolean(station.smartChargingEnabled),
    firmwareUpdateEnabled: Boolean(station.firmwareUpdateEnabled),
    localListEnabled: Boolean(station.localListEnabled),
    online: registry.isConnected(station.identity),
    lastSeenAt: station.lastSeenAt ?? null,
    offlineSince: station.offlineSince ?? null,
    meterStatus: station.meterStatus,
    faulted: station.connectors.some((c) => c.connectorId > 0 && c.status === 'Faulted'),
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
    if (c.standard && c.powerType && !powerTypeAllowed(c.standard, c.powerType)) {
      return `power type ${c.powerType} is not carried by connector standard ${c.standard}`;
    }
    for (const key of ['maxVoltage', 'maxAmperage']) {
      const v = c[key];
      if (v === '' || v == null) continue;
      if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 1000) return `${key} must be a whole number from 1 to 1000`;
    }
    if (c.phaseCount !== '' && c.phaseCount != null && ![1, 3].includes(Number(c.phaseCount))) {
      return 'phaseCount must be 1 (single-phase) or 3 (three-phase)';
    }
    if (Number(c.phaseCount) === 1 && c.phase && !['L1', 'L2', 'L3'].includes(c.phase)) {
      return `phase "${c.phase}" must be L1, L2 or L3`;
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
        // Wiring for phase-aware balancing. A three-phase connector has no single phase.
        phaseCount: blank(c.phaseCount) ? null : Number(c.phaseCount),
        phase: blank(c.phaseCount) || Number(c.phaseCount) === 3 || blank(c.phase) ? null : c.phase,
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

async function resolveZoneId(zoneId) {
  if (!zoneId) return { zoneId: null };
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) return { error: 'Zone not found' };
  return { zoneId: zone.id };
}

adminStationsRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const rows = await prisma.station.findMany({
    where: afterPosition(page.position, 'name', { direction: 'asc' }),
    include: { connectors: true, zone: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (s) => ({ v: s.name, i: s.id }));
  res.json({ data: result.data.map(serialize), nextCursor: result.nextCursor });
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

const TEST_TIMEOUT_MS = 10000;
const TEST_POLL_MS = 500;

// The connection test runs as a sequence of steps. The admin page calls one step at a
// time and shows each result. The last two steps prove that the software can take the
// charge point out of service and bring it back.
export const CONNECTION_TEST_STEPS = [
  'connected',
  'configuration',
  'deactivate',
  'deactivated',
  'activate',
  'activated',
];

function withTimeout(promise, ms = TEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Connectors (and the whole-station row, 0) that the charge point has reported on since `since`.
async function reportsSince(stationId, since) {
  return prisma.connector.findMany({ where: { stationId, updatedAt: { gte: since } } });
}

// Waits until every connector the charge point has reported matches `matches`, with each
// report arriving after `since`. Returns { ok, message }.
async function waitForStatus(stationId, since, matches, what) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  let last = [];
  while (Date.now() < deadline) {
    last = (await reportsSince(stationId, since)).filter((c) => c.connectorId > 0);
    if (last.length > 0 && last.every((c) => matches(c.status))) {
      return {
        ok: true,
        message: `The charge point reports ${what} on ${last.length} connector${last.length === 1 ? '' : 's'}.`,
        details: connectorLines(last),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, TEST_POLL_MS));
  }
  if (last.length === 0) {
    return {
      ok: false,
      message: `The charge point did not report its status within ${TEST_TIMEOUT_MS / 1000} seconds.`,
      details: ['No status reports arrived after this step started.'],
    };
  }
  const statuses = [...new Set(last.map((c) => c.status))].join(', ');
  return {
    ok: false,
    message: `Expected ${what}, but the charge point reports: ${statuses}.`,
    details: connectorLines(last),
  };
}

// One line per connector with the status it last reported, for the test's details.
function connectorLines(connectors) {
  return [...connectors]
    .sort((a, b) => a.connectorId - b.connectorId)
    .map((c) => `Connector ${c.connectorId}: ${c.status}`);
}

// Asks the charge point to go out of service (Inoperative) or back into service (Operative).
async function changeAvailability(client, stationId, type) {
  const result = await withTimeout(client.call('ChangeAvailability', { connectorId: 0, type }));
  const status = result?.status;
  const details = [`Request: ChangeAvailability, connector 0, type ${type}`, `Response status: ${status ?? 'none'}`];
  if (status === 'Accepted') {
    return { ok: true, message: `The charge point accepted the request (${type}).`, details };
  }
  if (status === 'Scheduled') {
    return {
      ok: true,
      message: `The charge point scheduled the change. It applies once its current task ends.`,
      details,
    };
  }
  return { ok: false, message: `The charge point replied ${status ?? 'with no status'} to ${type}.`, details };
}

// The settings the charge point returned, one line each. Values of secrets (such as the
// authorization key) are hidden, so they are not shown in the browser.
function configurationLines(result) {
  const keys = Array.isArray(result?.configurationKey) ? result.configurationKey : [];
  const lines = keys.map((k) => {
    const secret = /key|password|secret|token/i.test(k.key ?? '');
    const value = secret ? '(hidden)' : k.value === undefined ? '(no value)' : String(k.value);
    return `${k.key}: ${value}${k.readonly ? ' (read-only)' : ''}`;
  });
  const unknown = Array.isArray(result?.unknownKey) ? result.unknownKey : [];
  if (unknown.length > 0) lines.push(`Not recognised: ${unknown.join(', ')}`);
  return lines;
}

// One step of the connection test. Body: { identity, since? } where `since` is the ISO
// time the step sequence started for the status checks.
adminStationsRouter.post('/test-connection/:step', async (req, res) => {
  const step = req.params.step;
  if (!CONNECTION_TEST_STEPS.includes(step)) return res.status(404).json({ error: 'Unknown test step' });

  const identity = typeof req.body?.identity === 'string' ? req.body.identity.trim() : '';
  if (!identity) return res.status(400).json({ error: 'identity is required' });

  const station = await prisma.station.findUnique({ where: { identity } });
  if (!station) {
    return res.status(404).json({ error: `No charge point with identity "${identity}" in this site` });
  }

  const client = registry.getClient(identity);
  const notConnected = {
    ok: false,
    message: 'The charge point is not connected. Point it at the address shown, and check that it can reach this server.',
  };
  const since = req.body?.since ? new Date(req.body.since) : new Date(Date.now() - TEST_TIMEOUT_MS);
  if (Number.isNaN(since.getTime())) return res.status(400).json({ error: 'since must be a time' });

  try {
    if (step === 'connected') {
      return res.json(client ? { ok: true, message: 'The charge point is connected.' } : notConnected);
    }
    if (!client) return res.json(notConnected);

    if (step === 'configuration') {
      const result = await withTimeout(client.call('GetConfiguration', {}));
      const count = Array.isArray(result?.configurationKey) ? result.configurationKey.length : 0;
      return res.json({
        ok: true,
        message: `The charge point answered with ${count} setting${count === 1 ? '' : 's'}.`,
        details: configurationLines(result),
      });
    }

    if (step === 'deactivate') {
      // Taking a charge point out of service during a session would stop the driver's charging.
      const open = await prisma.transaction.count({ where: { stationId: station.id, stoppedAt: null } });
      if (open > 0) {
        return res.json({
          ok: false,
          message: 'A charging session is in progress. Stop it, then run the test again.',
          details: [`Open charging sessions: ${open}`],
        });
      }
      return res.json(await changeAvailability(client, station.id, 'Inoperative'));
    }

    if (step === 'deactivated') {
      return res.json(await waitForStatus(station.id, since, (s) => s === 'Unavailable', 'Unavailable'));
    }

    if (step === 'activate') {
      return res.json(await changeAvailability(client, station.id, 'Operative'));
    }

    // activated: any status other than Unavailable or Faulted means the charge point is back in service.
    return res.json(
      await waitForStatus(station.id, since, (s) => s !== 'Unavailable' && s !== 'Faulted', 'a status in service'),
    );
  } catch (err) {
    const message =
      err.message === 'timeout'
        ? 'The charge point did not answer in time. Check its network connection.'
        : 'The charge point returned an error to the test.';
    return res.json({ ok: false, message });
  }
});

adminStationsRouter.get('/:id', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { connectors: true, zone: true },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json(serialize(station));
});

// Everything the station page shows about a charge point's state: connection, what it
// reports about itself, live meter readings, open sessions, holds, and recent history.
adminStationsRouter.get('/:id/status', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { connectors: true },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });

  const [readings, sessions, holds, events] = await Promise.all([
    latestReadings(station.id),
    prisma.transaction.findMany({ where: { stationId: station.id, stoppedAt: null }, orderBy: { startedAt: 'desc' } }),
    prisma.reservation.findMany({ where: { stationId: station.id, status: 'ACTIVE' } }),
    prisma.stationEvent.findMany({ where: { stationId: station.id }, orderBy: { at: 'desc' }, take: 50 }),
  ]);

  const connectors = station.connectors
    .filter((c) => c.connectorId > 0)
    .sort((a, b) => a.connectorId - b.connectorId)
    .map((c) => {
      const own = readings.filter((r) => r.connectorId === c.connectorId);
      const hold = holds.find((h) => h.connectorId === c.connectorId);
      return {
        connectorId: c.connectorId,
        status: c.status,
        errorCode: c.errorCode,
        info: c.info,
        vendorErrorCode: c.vendorErrorCode,
        operative: c.operative,
        readings: Object.fromEntries(own.map((r) => [r.measurand, { value: r.value, at: r.at }])),
        hold: hold
          ? { id: hold.id, idTag: hold.idTag, note: hold.note, expiresAt: hold.expiresAt, manual: hold.queueEntryId == null }
          : null,
      };
    });

  res.json({
    id: station.id,
    name: station.name,
    identity: station.identity,
    online: registry.isConnected(station.identity),
    lastSeenAt: station.lastSeenAt,
    offlineSince: station.offlineSince,
    vendor: station.vendor,
    smartChargingEnabled: Boolean(station.smartChargingEnabled),
    firmwareUpdateEnabled: Boolean(station.firmwareUpdateEnabled),
    localListEnabled: Boolean(station.localListEnabled),
    model: station.model,
    serialNumber: station.serialNumber,
    firmwareVersion: station.firmwareVersion,
    firmwareStatus: station.firmwareStatus,
    diagnosticsStatus: station.diagnosticsStatus,
    meterStatus: station.meterStatus,
    configurationAt: station.configurationAt,
    connectors,
    sessions: sessions.map((t) => ({
      id: t.id,
      connectorId: t.connectorId,
      idTag: t.idTag,
      startedAt: t.startedAt,
      ocppTransactionId: t.ocppTransactionId,
    })),
    events: events.map((e) => ({ id: e.id, at: e.at, kind: e.kind, detail: e.detail, connectorId: e.connectorId })),
  });
});

// Whether the charge point has an NFC reader that accepts wallet passes. Only true or false is accepted.
function walletTapProblem(value) {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'boolean') return { error: 'walletTap must be true or false' };
  return { value };
}

// The OCPP features an admin enables for a charge point. Each is on only when the admin says the
// hardware supports it. Only true or false is accepted; undefined leaves the stored value alone.
export const FEATURE_FLAGS = ['smartChargingEnabled', 'firmwareUpdateEnabled', 'localListEnabled'];

export function featureFlagsProblem(body) {
  const value = {};
  for (const key of FEATURE_FLAGS) {
    if (body?.[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') return { error: `${key} must be true or false` };
    value[key] = body[key];
  }
  return { value };
}

adminStationsRouter.post('/', async (req, res) => {
  const { identity, name, vendor, model, location, connectorCount, zoneId, latitude, longitude, connectors } = req.body ?? {};
  const coordsProblem = coordinatesProblem(latitude, longitude);
  if (coordsProblem) return res.status(400).json({ error: coordsProblem });
  const textFields = locatorTextFields(req.body);
  if (textFields.error) return res.status(400).json({ error: textFields.error });
  const tips = cleanText(req.body?.tips, 'Tips', TIPS_MAX);
  if (tips.error) return res.status(400).json({ error: tips.error });
  const parking = normalizeParkingKeys(req.body?.parkingKeys);
  if (parking.error) return res.status(400).json({ error: parking.error });
  const wallet = walletTapProblem(req.body?.walletTap);
  if (wallet.error) return res.status(400).json({ error: wallet.error });
  const features = featureFlagsProblem(req.body);
  if (features.error) return res.status(400).json({ error: features.error });
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
      ...textFields.fields,
      tips: tips.value,
      parkingKeys: parking.value ?? null,
      walletTap: wallet.value ?? false,
      ...features.value,
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
  const coordsProblem = coordinatesProblem(latitude, longitude);
  if (coordsProblem) return res.status(400).json({ error: coordsProblem });
  const textFields = locatorTextFields(req.body);
  if (textFields.error) return res.status(400).json({ error: textFields.error });
  const tips = cleanText(req.body?.tips, 'Tips', TIPS_MAX);
  if (tips.error) return res.status(400).json({ error: tips.error });
  const parking = normalizeParkingKeys(req.body?.parkingKeys);
  if (parking.error) return res.status(400).json({ error: parking.error });
  const wallet = walletTapProblem(req.body?.walletTap);
  if (wallet.error) return res.status(400).json({ error: wallet.error });
  const features = featureFlagsProblem(req.body);
  if (features.error) return res.status(400).json({ error: features.error });

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
      ...textFields.fields,
      // Left alone when the request does not send tips at all.
      tips: tips.value,
      // Likewise for parking: only changed when the list is sent.
      ...(parking.value !== undefined && { parkingKeys: parking.value }),
      // Left alone when the request does not send it.
      ...(wallet.value !== undefined && { walletTap: wallet.value }),
      ...features.value,
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
