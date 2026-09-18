import { Router } from 'express';
import { getQueueStatus } from '../services/queueService.js';
import { cancelQueueEntry, requestStartCharging, reportLineCutter } from '../services/dispatcher.js';

export const waitlistRouter = Router();

function serializeEntry({ entry, position }) {
  // Once matched, the reservation always names the specific station the
  // entry landed on (this is true for zone entries too -- see
  // dispatcher.js's onConnectorFreed). Until then, a zone entry has no
  // station yet, so fall back to the zone's name.
  const matchedStation = entry.reservation?.station ?? entry.station;
  return {
    id: entry.id,
    stationId: entry.stationId,
    stationName: matchedStation?.name ?? entry.zone?.name ?? null,
    zoneName: entry.zone?.name ?? null,
    name: entry.name,
    licensePlate: entry.licensePlate,
    parkingPermit: entry.parkingPermit,
    status: entry.status,
    position,
    reservation: entry.reservation
      ? {
          connectorId: entry.reservation.connectorId,
          expiresAt: entry.reservation.expiresAt,
          status: entry.reservation.status,
        }
      : null,
    createdAt: entry.createdAt,
  };
}

waitlistRouter.get('/:id', async (req, res) => {
  const result = await getQueueStatus(req.params.id);
  if (!result) return res.status(404).json({ error: 'Waitlist entry not found' });
  res.json(serializeEntry(result));
});

waitlistRouter.delete('/:id', async (req, res) => {
  const entry = await cancelQueueEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });
  res.json({ id: entry.id, status: entry.status });
});

waitlistRouter.post('/:id/start-charging', async (req, res) => {
  try {
    await requestStartCharging(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

waitlistRouter.post('/:id/report-line-cutter', async (req, res) => {
  try {
    const report = await reportLineCutter(req.params.id, req.body?.note);
    res.status(201).json({ id: report.id });
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});
