import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Placeholder values from older examples and docs. Refused when they are set
// explicitly, because anyone can read them.
export const PLACEHOLDER_SECRETS = ['dev-secret-change-me', 'change-me-to-a-long-random-string'];

function fromEnv(value, name) {
  if (value === undefined || value === '') return undefined;
  if (PLACEHOLDER_SECRETS.includes(value)) {
    throw new Error(
      `${name} is set to a placeholder value. Remove it to have one generated on first start, ` +
        'or set a long random value (for example: openssl rand -base64 32).',
    );
  }
  return value;
}

// Returns the two installation secrets. Values from the environment win. Any
// secret that is not set is generated once and kept in `<dataDir>/secrets.json`
// (mode 0600), so an operator needs no extra setup. `generated` names what was
// created on this call, so the caller can tell the operator to back it up.
export function loadSecrets({ env, dataDir }) {
  const fromEnvJwt = fromEnv(env.JWT_SECRET, 'JWT_SECRET');
  const fromEnvEncryption = fromEnv(env.CONFIG_ENCRYPTION_KEY, 'CONFIG_ENCRYPTION_KEY');
  if (fromEnvJwt && fromEnvEncryption) {
    return { jwtSecret: fromEnvJwt, encryptionKey: fromEnvEncryption, generated: [] };
  }

  const file = path.join(dataDir, 'secrets.json');
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const secrets = {
    jwtSecret: fromEnvJwt ?? stored.jwtSecret,
    encryptionKey: fromEnvEncryption ?? stored.encryptionKey,
  };

  const generated = [];
  if (!secrets.jwtSecret) {
    secrets.jwtSecret = randomBytes(32).toString('base64');
    generated.push('JWT_SECRET');
  }
  if (!secrets.encryptionKey) {
    secrets.encryptionKey = randomBytes(32).toString('base64');
    generated.push('CONFIG_ENCRYPTION_KEY');
  }

  if (generated.length) {
    // Only what was generated goes to disk. Values from the environment are never copied.
    const toStore = { ...stored };
    if (generated.includes('JWT_SECRET')) toStore.jwtSecret = secrets.jwtSecret;
    if (generated.includes('CONFIG_ENCRYPTION_KEY')) toStore.encryptionKey = secrets.encryptionKey;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(toStore, null, 2), { mode: 0o600 });
  }

  return { ...secrets, generated, file };
}
