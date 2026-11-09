import express, { Router } from 'express';
import { rawPrisma } from '../db.js';
import { enterTenant } from '../tenancy/context.js';
import { recordStationEvent } from '../services/stationEvents.js';
import {
  DIAGNOSTICS_MAX_BYTES,
  hashUploadToken,
  newStorageKey,
  removeStoredFile,
  storedFileExists,
  storedPath,
  verifyFirmwareLink,
  writeStoredFile,
} from '../services/fileStore.js';

// Addresses that charge points use, without an admin login. Each link is either signed (firmware)
// or a one-time token (diagnostics uploads), so nothing else on the server can be reached this way.
// The tenant is found from the record, so the same address works for every site.
export const deviceFilesRouter = Router();

// Firmware download: GET /api/device-files/firmware/:packageId/:expires/:signature
deviceFilesRouter.get('/firmware/:packageId/:expires/:signature', async (req, res) => {
  const { packageId, expires, signature } = req.params;
  if (!verifyFirmwareLink(packageId, expires, signature)) return res.status(403).end();
  const pkg = await rawPrisma.firmwarePackage.findUnique({ where: { id: packageId } });
  if (!pkg || !storedFileExists('firmware', pkg.storageKey)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(pkg.sizeBytes));
  res.setHeader('Content-Disposition', `attachment; filename="${pkg.fileName}"`);
  res.sendFile(storedPath('firmware', pkg.storageKey));
});

// Diagnostics upload: PUT or POST /api/device-files/diagnostics/:token, with the log as the body.
const acceptDiagnostics = express.raw({ type: () => true, limit: DIAGNOSTICS_MAX_BYTES });

async function receiveDiagnostics(req, res) {
  const log = await rawPrisma.diagnosticsLog.findUnique({ where: { tokenHash: hashUploadToken(req.params.token) } });
  if (!log) return res.status(404).end();
  if (log.status === 'UPLOADED') return res.status(409).json({ error: 'This log has already been uploaded' });
  if (log.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: 'The upload address has expired' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Send the log as the body' });

  const storageKey = newStorageKey();
  const stored = await writeStoredFile('diagnostics', storageKey, req.body);
  const station = await rawPrisma.station.findUnique({ where: { id: log.stationId }, select: { identity: true } });
  const fileName = `${station?.identity ?? 'charge-point'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  try {
    await rawPrisma.diagnosticsLog.update({
      where: { id: log.id },
      data: { status: 'UPLOADED', uploadedAt: new Date(), storageKey, fileName, ...stored },
    });
  } catch (err) {
    await removeStoredFile('diagnostics', storageKey);
    throw err;
  }
  await enterTenant(log.tenantId, () =>
    recordStationEvent(log.stationId, 'DIAGNOSTICS', 'Diagnostics log uploaded'),
  ).catch((err) => console.error('[files] could not record diagnostics upload:', err.message));
  res.status(200).json({ id: log.id });
}

deviceFilesRouter.put('/diagnostics/:token', acceptDiagnostics, receiveDiagnostics);
deviceFilesRouter.post('/diagnostics/:token', acceptDiagnostics, receiveDiagnostics);
