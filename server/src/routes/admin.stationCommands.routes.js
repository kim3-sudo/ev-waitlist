import { Router } from 'express';
import { prisma } from '../db.js';
import { callStation, logCommand } from '../services/stationCommands.js';
import { refreshConfiguration } from '../services/stationConfigure.js';
import { registry } from '../services/stationRegistry.js';
import { nextReservationId } from '../services/reservationIdCounter.js';
import { releaseReservation, onConnectorFreed } from '../services/dispatcher.js';
import { DIAGNOSTICS_UPLOAD_HOURS, newUploadToken, publicBase, signFirmwareLink } from '../services/fileStore.js';
import { sendLocalList } from '../services/localList.js';

// Commands an admin sends to a charge point. Mounted behind stations.control.
// Every command the charge point answers is recorded in the station's history.
export const adminStationCommandsRouter = Router();

const TRIGGERABLE = [
  'BootNotification',
  'Heartbeat',
  'StatusNotification',
  'MeterValues',
  'DiagnosticsStatusNotification',
  'FirmwareStatusNotification',
];

// The settings an admin may change from the station page. Anything else is refused,
// even if the charge point would accept it.
export const EDITABLE_KEYS = new Set([
  'HeartbeatInterval',
  'MeterValueSampleInterval',
  'MeterValuesSampledData',
  'StopTxnSampledData',
  'ClockAlignedDataInterval',
  'ConnectionTimeOut',
  'AuthorizeRemoteTxRequests',
  'LocalPreAuthorize',
  'AuthorizationCacheEnabled',
  'StopTransactionOnEVSideDisconnect',
  'UnlockConnectorOnEVSideDisconnect',
]);

async function loadStation(req, res) {
  const station = await prisma.station.findUnique({ where: { id: req.params.stationId }, include: { connectors: true } });
  if (!station) {
    res.status(404).json({ error: 'Charge point not found' });
    return null;
  }
  return station;
}

const actorOf = (req) => req.admin?.sub ?? null;

// Maps a failed call to an HTTP answer. A charge point that isn't connected is a conflict,
// not a server error.
function failure(res, outcome) {
  return res.status(outcome.offline ? 409 : 502).json({ error: outcome.message });
}

function connectorOf(station, connectorId) {
  return station.connectors.find((c) => c.connectorId === connectorId) ?? null;
}

async function openSessionOn(stationId, connectorId) {
  return prisma.transaction.findFirst({ where: { stationId, connectorId, stoppedAt: null } });
}

// Stop an open session (RemoteStopTransaction). The session ends when the charge point
// reports StopTransaction, so this answers "stop requested".
adminStationCommandsRouter.post('/:stationId/transactions/:transactionId/stop', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const tx = await prisma.transaction.findFirst({
    where: { id: req.params.transactionId, stationId: station.id, stoppedAt: null },
  });
  if (!tx) return res.status(404).json({ error: 'No open session with that id at this charge point' });

  const outcome = await callStation(station, 'RemoteStopTransaction', { transactionId: tx.ocppTransactionId });
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') {
    return res.status(409).json({ error: 'The charge point declined to stop the session.' });
  }
  await logCommand(station, actorOf(req), `Asked the charge point to stop transaction ${tx.ocppTransactionId}.`, {
    connectorId: tx.connectorId,
  });
  res.status(202).json({ message: 'Stop requested. The session ends when the charge point reports it.' });
});

// Ask the charge point to send one of its messages now (TriggerMessage).
adminStationCommandsRouter.post('/:stationId/trigger', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const { requestedMessage, connectorId } = req.body ?? {};
  if (!TRIGGERABLE.includes(requestedMessage)) {
    return res.status(400).json({ error: `requestedMessage must be one of: ${TRIGGERABLE.join(', ')}` });
  }
  const params = { requestedMessage };
  if (connectorId !== undefined && connectorId !== null) {
    if (!Number.isInteger(connectorId) || (connectorId !== 0 && !connectorOf(station, connectorId))) {
      return res.status(400).json({ error: 'connectorId must be a connector of this charge point' });
    }
    params.connectorId = connectorId;
  }

  const outcome = await callStation(station, 'TriggerMessage', params);
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') {
    return res.status(409).json({ error: `The charge point replied ${outcome.result?.status ?? 'with no status'}.` });
  }
  await logCommand(station, actorOf(req), `Asked the charge point to send ${requestedMessage}.`, {
    connectorId: params.connectorId ?? null,
  });
  res.status(202).json({ message: `Asked the charge point to send ${requestedMessage}.` });
});

// Release the cable lock on a connector. Unlocking during a session ends it, so that needs
// the admin's confirmation.
adminStationCommandsRouter.post('/:stationId/connectors/:connectorId/unlock', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const connectorId = Number(req.params.connectorId);
  if (!connectorOf(station, connectorId)) return res.status(404).json({ error: 'Connector not found' });

  const open = await openSessionOn(station.id, connectorId);
  if (open && req.body?.confirmEndSession !== true) {
    return res.status(409).json({
      error: 'A charging session is in progress on this connector. Unlocking ends it. Confirm to continue.',
      needsConfirmation: true,
    });
  }

  const outcome = await callStation(station, 'UnlockConnector', { connectorId });
  if (!outcome.ok) return failure(res, outcome);
  const status = outcome.result?.status;
  if (status !== 'Unlocked') {
    const why = status === 'NotSupported' ? "This charge point can't unlock its connectors remotely." : 'The charge point could not unlock the connector.';
    return res.status(409).json({ error: why });
  }
  await logCommand(station, actorOf(req), `Unlocked connector ${connectorId}${open ? ', ending the session' : ''}.`, {
    connectorId,
  });
  res.status(202).json({ message: `Connector ${connectorId} unlocked.` });
});

// Restart the charge point (Reset). A hard reset ends any sessions in progress, so that
// needs confirmation when sessions are open.
adminStationCommandsRouter.post('/:stationId/reset', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const type = req.body?.type === 'Hard' ? 'Hard' : 'Soft';
  const open = await prisma.transaction.count({ where: { stationId: station.id, stoppedAt: null } });
  if (open > 0 && req.body?.confirmEndSession !== true) {
    return res.status(409).json({
      error: `${open} charging session${open === 1 ? ' is' : 's are'} in progress. Restarting ends ${open === 1 ? 'it' : 'them'}. Confirm to continue.`,
      needsConfirmation: true,
    });
  }

  const outcome = await callStation(station, 'Reset', { type });
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') {
    return res.status(409).json({ error: 'The charge point declined to restart.' });
  }
  await logCommand(station, actorOf(req), `Asked the charge point to restart (${type}).`);
  res.status(202).json({ message: `Restart requested (${type}). The charge point reports again once it has restarted.` });
});

// Take a connector out of service, or back in (ChangeAvailability). The admin's choice is
// saved first, so dispatch skips the connector even while the charge point is offline.
adminStationCommandsRouter.post('/:stationId/connectors/:connectorId/availability', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const connectorId = Number(req.params.connectorId);
  const connector = connectorOf(station, connectorId);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });
  if (typeof req.body?.operative !== 'boolean') return res.status(400).json({ error: 'operative must be true or false' });
  const operative = req.body.operative;

  await prisma.connector.update({
    where: { stationId_connectorId: { stationId: station.id, connectorId } },
    data: { operative },
  });
  await logCommand(station, actorOf(req), `Set connector ${connectorId} ${operative ? 'in service' : 'out of service'}.`, {
    connectorId,
  });

  if (!registry.isConnected(station.identity)) {
    return res.json({ message: `Saved. Connector ${connectorId} will ${operative ? 'be offered again' : 'stay out of service'} once the charge point is connected.` });
  }
  const outcome = await callStation(station, 'ChangeAvailability', {
    connectorId,
    type: operative ? 'Operative' : 'Inoperative',
  });
  if (!outcome.ok) return res.json({ message: `Saved, but the charge point did not confirm: ${outcome.message}` });
  if (outcome.result?.status === 'Scheduled') {
    return res.json({ message: 'Saved. The charge point will change once the current session ends.' });
  }
  if (outcome.result?.status !== 'Accepted') {
    return res.json({ message: `Saved, but the charge point replied ${outcome.result?.status ?? 'with no status'}.` });
  }
  res.json({ message: `Connector ${connectorId} is ${operative ? 'back in service' : 'out of service'}.` });
});

// The configuration. With refresh=1 and the charge point connected, it is read again;
// otherwise the last saved copy is returned, marked as such.
adminStationCommandsRouter.get('/:stationId/configuration', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const online = registry.isConnected(station.identity);
  if (req.query.refresh === '1' && online) {
    const refreshed = await refreshConfiguration(station);
    if (!refreshed.ok) return failure(res, refreshed);
    return res.json({ ...refreshed.saved, online, fromCache: false, editable: [...EDITABLE_KEYS] });
  }
  const saved = station.configurationJson ? JSON.parse(station.configurationJson) : { keys: [], unknownKeys: [], at: null };
  res.json({ ...saved, online, fromCache: true, editable: [...EDITABLE_KEYS] });
});

adminStationCommandsRouter.put('/:stationId/configuration/:key', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const key = req.params.key;
  if (!EDITABLE_KEYS.has(key)) return res.status(400).json({ error: `${key} can't be changed from here` });
  const value = req.body?.value;
  if (typeof value !== 'string' || value.length > 500) return res.status(400).json({ error: 'value must be text of up to 500 characters' });

  const saved = station.configurationJson ? JSON.parse(station.configurationJson) : { keys: [], unknownKeys: [] };
  const entry = saved.keys.find((k) => k.key === key);
  if (entry?.readonly) return res.status(409).json({ error: `${key} is read-only on this charge point` });

  const outcome = await callStation(station, 'ChangeConfiguration', { key, value });
  if (!outcome.ok) return failure(res, outcome);
  const status = outcome.result?.status;
  await logCommand(station, actorOf(req), `Changed ${key} to ${value}: ${status}.`);

  if (status === 'Accepted' || status === 'RebootRequired') {
    if (entry) entry.value = value;
    await prisma.station.update({
      where: { id: station.id },
      data: { configurationJson: JSON.stringify(saved), configurationAt: new Date() },
    });
    const message = status === 'RebootRequired' ? `${key} saved. It takes effect after the charge point restarts.` : `${key} saved.`;
    return res.json({ status, message });
  }
  if (status === 'NotSupported') return res.status(400).json({ error: 'The charge point does not support that setting.' });
  return res.status(400).json({ error: 'The charge point rejected that value.' });
});

// Drop the charge point's cached ID tags.
adminStationCommandsRouter.post('/:stationId/clear-cache', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const outcome = await callStation(station, 'ClearCache', {});
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') return res.status(409).json({ error: 'The charge point declined to clear its cache.' });
  await logCommand(station, actorOf(req), 'Cleared the cached ID tags.');
  res.json({ message: 'Cleared the cached ID tags.' });
});

// Hold a connector for one ID tag, with no waitlist entry. Uses ReserveNow where the
// charge point supports it, and an app-only hold where it doesn't.
adminStationCommandsRouter.post('/:stationId/connectors/:connectorId/hold', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const connectorId = Number(req.params.connectorId);
  const connector = connectorOf(station, connectorId);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });

  const idTag = typeof req.body?.idTag === 'string' ? req.body.idTag.trim() : '';
  if (!idTag || idTag.length > 20) return res.status(400).json({ error: 'Enter an ID tag of up to 20 characters' });
  const minutes = req.body?.minutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
    return res.status(400).json({ error: 'minutes must be a whole number from 1 to 480' });
  }
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 200) : null;

  if (!connector.operative || connector.status === 'Unavailable' || connector.status === 'Faulted') {
    return res.status(409).json({ error: `Connector ${connectorId} is not available` });
  }
  if (await openSessionOn(station.id, connectorId)) {
    return res.status(409).json({ error: `Connector ${connectorId} is in use` });
  }
  const existing = await prisma.reservation.findFirst({ where: { stationId: station.id, connectorId, status: 'ACTIVE' } });
  if (existing) return res.status(409).json({ error: `Connector ${connectorId} is already held` });

  const expiresAt = new Date(Date.now() + minutes * 60_000);
  let ocppReservationId = null;
  if (registry.isConnected(station.identity)) {
    const reservationId = nextReservationId();
    const outcome = await callStation(station, 'ReserveNow', {
      connectorId,
      expiryDate: expiresAt.toISOString(),
      idTag,
      reservationId,
    });
    if (outcome.ok) {
      if (outcome.result?.status !== 'Accepted') {
        return res.status(409).json({ error: `The charge point replied ${outcome.result?.status ?? 'with no status'} to the hold.` });
      }
      ocppReservationId = reservationId;
    } else if (outcome.code !== 'NotSupported' && outcome.code !== 'NotImplemented') {
      return failure(res, outcome);
    }
    // Otherwise the charge point has no reservations: fall back to an app-only hold.
  }

  const hold = await prisma.reservation.create({
    data: {
      stationId: station.id,
      connectorId,
      ocppReservationId,
      expiresAt,
      status: 'ACTIVE',
      idTag,
      note,
      createdByAdminId: actorOf(req),
    },
  });
  await logCommand(station, actorOf(req), `Held connector ${connectorId} for ${idTag} for ${minutes} minutes.`, { connectorId });
  res.status(201).json({ id: hold.id, connectorId, idTag, expiresAt: hold.expiresAt, note });
});

// Release a manual hold early.
adminStationCommandsRouter.delete('/:stationId/holds/:reservationId', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  const hold = await prisma.reservation.findFirst({
    where: { id: req.params.reservationId, stationId: station.id, queueEntryId: null, status: 'ACTIVE' },
  });
  if (!hold) return res.status(404).json({ error: 'No active hold with that id at this charge point' });

  await releaseReservation(hold, station);
  await logCommand(station, actorOf(req), `Released the hold on connector ${hold.connectorId} for ${hold.idTag}.`, {
    connectorId: hold.connectorId,
  });
  // The connector may now be offered to someone waiting.
  await onConnectorFreed(station.id, hold.connectorId).catch((err) => console.error('Dispatch after release failed:', err));
  res.json({ message: 'Hold released.' });
});

// Firmware and diagnostics. Each one is sent only when the admin has turned firmware support on for
// this charge point, so hardware without the Firmware Management profile never gets the message.
function featureOff(res, what) {
  return res.status(409).json({
    error: `${what} is turned off for this charge point. Turn it on in the charge point's settings first.`,
  });
}

// Sends the charge point a firmware image to download and install (UpdateFirmware).
adminStationCommandsRouter.post('/:stationId/update-firmware', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  if (!station.firmwareUpdateEnabled) return featureOff(res, 'Firmware updates');
  const pkg = await prisma.firmwarePackage.findUnique({ where: { id: String(req.body?.firmwarePackageId ?? '') } });
  if (!pkg) return res.status(404).json({ error: 'Firmware not found' });
  const base = publicBase();
  if (!base) return res.status(409).json({ error: 'Set the site\'s public address first, so the charge point can reach the file.' });

  const retrieveDate = req.body?.retrieveDate ? new Date(req.body.retrieveDate) : new Date();
  if (Number.isNaN(retrieveDate.getTime())) return res.status(400).json({ error: 'retrieveDate must be a valid date' });
  const { expiresAtSeconds, signature } = signFirmwareLink(pkg.id);
  const location = `${base}/api/device-files/firmware/${pkg.id}/${expiresAtSeconds}/${signature}`;

  const outcome = await callStation(station, 'UpdateFirmware', {
    location,
    retrieveDate: retrieveDate.toISOString(),
    retries: 3,
    retryInterval: 300,
  });
  if (!outcome.ok) return failure(res, outcome);
  await logCommand(station, actorOf(req), `Asked the charge point to install firmware ${pkg.version} (${pkg.name}).`);
  res.status(202).json({ message: `Firmware ${pkg.version} requested. The charge point downloads it and reports progress.` });
});

// Asks the charge point to upload a diagnostics log to a one-time address (GetDiagnostics).
adminStationCommandsRouter.post('/:stationId/get-diagnostics', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  if (!station.firmwareUpdateEnabled) return featureOff(res, 'Diagnostics');
  const base = publicBase();
  if (!base) return res.status(409).json({ error: 'Set the site\'s public address first, so the charge point can reach the upload address.' });

  const { token, tokenHash } = newUploadToken();
  const expiresAt = new Date(Date.now() + DIAGNOSTICS_UPLOAD_HOURS * 3600 * 1000);
  const log = await prisma.diagnosticsLog.create({
    data: { stationId: station.id, tokenHash, expiresAt },
  });
  const location = `${base}/api/device-files/diagnostics/${token}`;

  const outcome = await callStation(station, 'GetDiagnostics', {
    location,
    retries: 3,
    retryInterval: 300,
    ...(req.body?.startTime && { startTime: new Date(req.body.startTime).toISOString() }),
    ...(req.body?.stopTime && { stopTime: new Date(req.body.stopTime).toISOString() }),
  });
  if (!outcome.ok) {
    await prisma.diagnosticsLog.update({ where: { id: log.id }, data: { status: 'FAILED' } });
    return failure(res, outcome);
  }
  await logCommand(station, actorOf(req), 'Asked the charge point for a diagnostics log.');
  res.status(202).json({ id: log.id, message: 'Diagnostics requested. The log appears in the list when the charge point uploads it.' });
});

// Smart charging: a power limit set by the server. The limit for the whole charge point is
// connector 0; a single connector has its own. Sent only when the admin turned smart charging on.
const chargingProfileId = (connectorId) => 100 + connectorId;

adminStationCommandsRouter.post('/:stationId/charging-limit', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  if (!station.smartChargingEnabled) return featureOff(res, 'Smart charging');
  const connectorId = Number(req.body?.connectorId ?? 0);
  if (!Number.isInteger(connectorId) || connectorId < 0) return res.status(400).json({ error: 'connectorId must be 0 (the whole charge point) or a connector number' });
  if (connectorId > 0 && !connectorOf(station, connectorId)) return res.status(404).json({ error: 'Connector not found' });
  const limitAmps = Number(req.body?.limitAmps);
  if (!Number.isInteger(limitAmps) || limitAmps < 1 || limitAmps > 1000) {
    return res.status(400).json({ error: 'limitAmps must be a whole number from 1 to 1000' });
  }

  const outcome = await callStation(station, 'SetChargingProfile', {
    connectorId,
    csChargingProfiles: {
      chargingProfileId: chargingProfileId(connectorId),
      stackLevel: 0,
      chargingProfilePurpose: connectorId === 0 ? 'ChargePointMaxProfile' : 'TxDefaultProfile',
      chargingProfileKind: 'Absolute',
      chargingSchedule: {
        chargingRateUnit: 'A',
        chargingSchedulePeriod: [{ startPeriod: 0, limit: limitAmps }],
      },
    },
  });
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') {
    return res.status(409).json({ error: `The charge point did not accept the limit (${outcome.result?.status ?? 'no answer'}).` });
  }
  const where = connectorId === 0 ? 'the charge point' : `connector ${connectorId}`;
  await logCommand(station, actorOf(req), `Limited ${where} to ${limitAmps} A.`, { connectorId: connectorId || null });
  res.status(202).json({ message: `${where[0].toUpperCase()}${where.slice(1)} limited to ${limitAmps} A.` });
});

adminStationCommandsRouter.delete('/:stationId/charging-limit', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  if (!station.smartChargingEnabled) return featureOff(res, 'Smart charging');
  const connectorId = Number(req.query.connectorId ?? 0);
  if (!Number.isInteger(connectorId) || connectorId < 0) return res.status(400).json({ error: 'connectorId must be 0 or a connector number' });
  const outcome = await callStation(station, 'ClearChargingProfile', {
    id: chargingProfileId(connectorId),
    connectorId,
    chargingProfilePurpose: connectorId === 0 ? 'ChargePointMaxProfile' : 'TxDefaultProfile',
  });
  if (!outcome.ok) return failure(res, outcome);
  await logCommand(station, actorOf(req), `Removed the power limit on ${connectorId === 0 ? 'the charge point' : `connector ${connectorId}`}.`, { connectorId: connectorId || null });
  res.json({ message: 'Power limit removed.' });
});

// Sends the site's local authorization list to this charge point now.
adminStationCommandsRouter.post('/:stationId/local-list', async (req, res) => {
  const station = await loadStation(req, res);
  if (!station) return;
  if (!station.localListEnabled) return featureOff(res, 'Local list support');
  const outcome = await sendLocalList(station, actorOf(req));
  if (!outcome.ok) return failure(res, outcome);
  if (outcome.result?.status !== 'Accepted') {
    return res.status(409).json({ error: `The charge point did not accept the list (${outcome.result?.status ?? 'no answer'}).` });
  }
  res.status(202).json({ message: 'The local list was sent to the charge point.' });
});
