import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { siteConfig } from './runtimeConfig.js';

// Files kept on local disk: firmware images an admin uploads, and diagnostics logs a charge
// point sends. They live under <data dir>/files/<kind>/<storage key>. The database holds the
// name, size and checksum, never the file's contents.

export const FIRMWARE_MAX_BYTES = 200 * 1024 * 1024;
export const DIAGNOSTICS_MAX_BYTES = 100 * 1024 * 1024;

// How long a firmware download link works, and how long a diagnostics upload address works.
export const FIRMWARE_LINK_DAYS = 3;
export const DIAGNOSTICS_UPLOAD_HOURS = 48;

const KINDS = new Set(['firmware', 'diagnostics']);
const ROOT = path.join(config.dataDir, 'files');

function folderFor(kind) {
  if (!KINDS.has(kind)) throw new Error(`Unknown file kind ${kind}`);
  return path.join(ROOT, kind);
}

// The storage key is a random UUID, so it never comes from a client and cannot point outside the folder.
export function newStorageKey() {
  return crypto.randomUUID();
}

export function storedPath(kind, storageKey) {
  if (!/^[0-9a-f-]{36}$/.test(storageKey)) throw new Error('Invalid storage key');
  return path.join(folderFor(kind), storageKey);
}

export function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Writes the file through a temporary name, so a half-written file is never left under the real key.
export async function writeStoredFile(kind, storageKey, buffer) {
  const target = storedPath(kind, storageKey);
  await fs.promises.mkdir(folderFor(kind), { recursive: true });
  const temp = `${target}.part`;
  await fs.promises.writeFile(temp, buffer);
  await fs.promises.rename(temp, target);
  return { sizeBytes: buffer.length, sha256: sha256Of(buffer) };
}

export async function removeStoredFile(kind, storageKey) {
  if (!storageKey) return;
  await fs.promises.rm(storedPath(kind, storageKey), { force: true });
}

export function storedFileExists(kind, storageKey) {
  return Boolean(storageKey) && fs.existsSync(storedPath(kind, storageKey));
}

// A file name from a client, reduced to a safe base name for downloads.
export function safeFileName(name, fallback = 'file.bin') {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return base || fallback;
}

// Signed download links for firmware. The link carries the package ID, the expiry and an HMAC,
// so a charge point can fetch the file without logging in, and nothing else can be fetched.
function linkKey() {
  return crypto.createHmac('sha256', config.encryptionKey).update('firmware-download-link').digest();
}

function linkSignature(packageId, expiresAtSeconds) {
  return crypto.createHmac('sha256', linkKey()).update(`${packageId}|${expiresAtSeconds}`).digest('hex');
}

export function signFirmwareLink(packageId, now = Date.now()) {
  const expiresAtSeconds = Math.floor(now / 1000) + FIRMWARE_LINK_DAYS * 24 * 3600;
  return { expiresAtSeconds, signature: linkSignature(packageId, expiresAtSeconds) };
}

export function verifyFirmwareLink(packageId, expiresAtSeconds, signature, now = Date.now()) {
  const expires = Number(expiresAtSeconds);
  if (!Number.isInteger(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(linkSignature(packageId, expires), 'utf8');
  const given = Buffer.from(String(signature ?? ''), 'utf8');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// The public base address for links the charge point will open, or null if the site has none.
export function publicBase() {
  const base = siteConfig().publicUrl;
  return base ? String(base).replace(/\/$/, '') : null;
}

// One-time upload address for a diagnostics log. The raw token is shown only in the link; the
// database keeps its SHA-256 hash.
export function newUploadToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
}

export function hashUploadToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
