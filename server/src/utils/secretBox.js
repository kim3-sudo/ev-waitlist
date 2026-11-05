import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM encryption for secrets stored in the database. The key is derived
// from CONFIG_ENCRYPTION_KEY, which lives in the server environment on purpose:
// the database can't hold the key that protects the database.
const PREFIX = 'enc:v1:';

export function isEncryptionReady() {
  return Boolean(config.encryptionKey);
}

function key() {
  return createHash('sha256').update(config.encryptionKey).digest();
}

export function encryptSecret(plain) {
  if (!isEncryptionReady()) throw new Error('CONFIG_ENCRYPTION_KEY is not set on the server');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

// Throws if the value was encrypted with a different key, or was tampered with.
export function decryptSecret(stored) {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) throw new Error('stored secret is not encrypted');
  if (!isEncryptionReady()) throw new Error('CONFIG_ENCRYPTION_KEY is not set on the server');
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
