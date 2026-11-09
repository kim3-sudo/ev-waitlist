import express, { Router } from 'express';
import { prisma } from '../db.js';
import {
  FIRMWARE_MAX_BYTES,
  newStorageKey,
  removeStoredFile,
  safeFileName,
  storedFileExists,
  storedPath,
  writeStoredFile,
} from '../services/fileStore.js';

// Firmware images and diagnostics logs, kept on local disk. Mounted behind stations.view (reads)
// and firmware.manage (uploads, edits, deletes).
export const adminFirmwareRouter = Router();

const NAME_MAX = 100;
const NOTES_MAX = 500;

function text(value, label, max, { required = false } = {}) {
  if (value === undefined && !required) return { value: undefined };
  const clean = String(value ?? '').trim();
  if (required && !clean) return { error: `${label} is required` };
  if (clean.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: clean || null };
}

function serializePackage(pkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    vendor: pkg.vendor,
    model: pkg.model,
    notes: pkg.notes,
    fileName: pkg.fileName,
    sizeBytes: pkg.sizeBytes,
    sha256: pkg.sha256,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

function serializeLog(log) {
  return {
    id: log.id,
    stationId: log.stationId,
    stationName: log.station?.name ?? null,
    status: log.status,
    requestedAt: log.requestedAt,
    uploadedAt: log.uploadedAt,
    expiresAt: log.expiresAt,
    fileName: log.fileName,
    sizeBytes: log.sizeBytes,
    sha256: log.sha256,
    hasFile: Boolean(log.storageKey),
  };
}

function metadataFrom(source, { requireName }) {
  const name = text(source.name, 'Name', NAME_MAX, { required: requireName });
  if (name.error) return name;
  const version = text(source.version, 'Version', NAME_MAX, { required: requireName });
  if (version.error) return version;
  const vendor = text(source.vendor, 'Vendor', NAME_MAX);
  if (vendor.error) return vendor;
  const model = text(source.model, 'Model', NAME_MAX);
  if (model.error) return model;
  const notes = text(source.notes, 'Notes', NOTES_MAX);
  if (notes.error) return notes;
  return {
    value: {
      ...(name.value !== undefined && { name: name.value }),
      ...(version.value !== undefined && { version: version.value }),
      ...(vendor.value !== undefined && { vendor: vendor.value }),
      ...(model.value !== undefined && { model: model.value }),
      ...(notes.value !== undefined && { notes: notes.value }),
    },
  };
}

adminFirmwareRouter.get('/', async (_req, res) => {
  const rows = await prisma.firmwarePackage.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  res.json({ data: rows.map(serializePackage) });
});

// The file goes in the request body as raw bytes. Name, version and the optional details are query
// parameters, and the file name is sent in the X-File-Name header.
adminFirmwareRouter.post(
  '/',
  express.raw({ type: () => true, limit: FIRMWARE_MAX_BYTES }),
  async (req, res) => {
    const meta = metadataFrom(req.query, { requireName: true });
    if (meta.error) return res.status(400).json({ error: meta.error });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Send the firmware file as the request body' });
    }
    const fileName = safeFileName(req.get('x-file-name'), 'firmware.bin');
    const storageKey = newStorageKey();
    const stored = await writeStoredFile('firmware', storageKey, req.body);
    try {
      const pkg = await prisma.firmwarePackage.create({
        data: {
          name: meta.value.name,
          version: meta.value.version,
          vendor: meta.value.vendor ?? null,
          model: meta.value.model ?? null,
          notes: meta.value.notes ?? null,
          fileName,
          storageKey,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        },
      });
      res.status(201).json(serializePackage(pkg));
    } catch (err) {
      await removeStoredFile('firmware', storageKey);
      throw err;
    }
  },
);

adminFirmwareRouter.patch('/:id', async (req, res) => {
  const pkg = await prisma.firmwarePackage.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: 'Firmware not found' });
  const meta = metadataFrom(req.body ?? {}, { requireName: false });
  if (meta.error) return res.status(400).json({ error: meta.error });
  const updated = await prisma.firmwarePackage.update({ where: { id: pkg.id }, data: meta.value });
  res.json(serializePackage(updated));
});

adminFirmwareRouter.get('/:id/download', async (req, res) => {
  const pkg = await prisma.firmwarePackage.findUnique({ where: { id: req.params.id } });
  if (!pkg || !storedFileExists('firmware', pkg.storageKey)) return res.status(404).json({ error: 'Firmware file not found' });
  res.download(storedPath('firmware', pkg.storageKey), pkg.fileName);
});

adminFirmwareRouter.delete('/:id', async (req, res) => {
  const pkg = await prisma.firmwarePackage.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: 'Firmware not found' });
  // The row goes first, so a failed file removal leaves an orphan file, never a row with no file.
  await prisma.firmwarePackage.delete({ where: { id: pkg.id } });
  await removeStoredFile('firmware', pkg.storageKey).catch((err) =>
    console.error(`[files] could not remove firmware file ${pkg.storageKey}:`, err.message),
  );
  res.status(204).end();
});

// Diagnostics logs requested from charge points.
adminFirmwareRouter.get('/diagnostics', async (req, res) => {
  const where = typeof req.query.stationId === 'string' && req.query.stationId ? { stationId: req.query.stationId } : {};
  const rows = await prisma.diagnosticsLog.findMany({
    where,
    include: { station: { select: { name: true } } },
    orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
    take: 200,
  });
  res.json({ data: rows.map(serializeLog) });
});

adminFirmwareRouter.get('/diagnostics/:id/download', async (req, res) => {
  const log = await prisma.diagnosticsLog.findUnique({ where: { id: req.params.id } });
  if (!log || !storedFileExists('diagnostics', log.storageKey)) {
    return res.status(404).json({ error: 'Diagnostics log not found' });
  }
  res.download(storedPath('diagnostics', log.storageKey), log.fileName ?? 'diagnostics.log');
});

adminFirmwareRouter.delete('/diagnostics/:id', async (req, res) => {
  const log = await prisma.diagnosticsLog.findUnique({ where: { id: req.params.id } });
  if (!log) return res.status(404).json({ error: 'Diagnostics log not found' });
  await prisma.diagnosticsLog.delete({ where: { id: log.id } });
  await removeStoredFile('diagnostics', log.storageKey).catch((err) =>
    console.error(`[files] could not remove diagnostics file ${log.storageKey}:`, err.message),
  );
  res.status(204).end();
});
