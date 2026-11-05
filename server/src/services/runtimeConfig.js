import { prisma } from '../db.js';
import { config } from '../config.js';
import { encryptSecret, decryptSecret, isEncryptionReady } from '../utils/secretBox.js';

// Every setting that moved out of the environment file. `env` is the old
// variable name, read once to seed the database when no row exists yet.
// `kind` decides validation and storage: url | int | enum | text | secret.
// `group` decides which admin page (and permission) can change it.
export const SETTING_DEFS = {
  publicUrl: { env: 'PUBLIC_URL', fallback: 'http://localhost:4000', kind: 'url', group: 'system' },
  corsOrigin: { env: 'CORS_ORIGIN', fallback: 'http://localhost:5173', kind: 'url', group: 'system' },
  webUrl: { env: 'WEB_PUBLIC_URL', fallback: 'http://localhost:5173', kind: 'url', group: 'system' },
  reservationWindowMinutes: {
    env: 'RESERVATION_WINDOW_MINUTES', fallback: '15', kind: 'int', min: 1, max: 1440, group: 'system',
  },

  'stripe.secretKey': { env: 'STRIPE_SECRET_KEY', fallback: '', kind: 'secret', group: 'stripe' },
  'stripe.webhookSecret': { env: 'STRIPE_WEBHOOK_SECRET', fallback: '', kind: 'secret', group: 'stripe' },

  'braintree.environment': {
    env: 'BRAINTREE_ENVIRONMENT', fallback: 'sandbox', kind: 'enum', values: ['sandbox', 'production'], group: 'braintree',
  },
  'braintree.merchantId': { env: 'BRAINTREE_MERCHANT_ID', fallback: '', kind: 'text', group: 'braintree' },
  'braintree.publicKey': { env: 'BRAINTREE_PUBLIC_KEY', fallback: '', kind: 'text', group: 'braintree' },
  'braintree.privateKey': { env: 'BRAINTREE_PRIVATE_KEY', fallback: '', kind: 'secret', group: 'braintree' },

  'square.environment': {
    env: 'SQUARE_ENVIRONMENT', fallback: 'sandbox', kind: 'enum', values: ['sandbox', 'production'], group: 'square',
  },
  'square.accessToken': { env: 'SQUARE_ACCESS_TOKEN', fallback: '', kind: 'secret', group: 'square' },
  'square.locationId': { env: 'SQUARE_LOCATION_ID', fallback: '', kind: 'text', group: 'square' },
  'square.webhookSignatureKey': { env: 'SQUARE_WEBHOOK_SIGNATURE_KEY', fallback: '', kind: 'secret', group: 'square' },
  // Optional: empty means "derive from the public URL".
  'square.webhookUrl': { env: 'SQUARE_WEBHOOK_URL', fallback: '', kind: 'url', group: 'square', optional: true },
};

const SECRET_KINDS = new Set(['secret']);

function setPath(obj, path, value) {
  const parts = path.split('.');
  let target = obj;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = value;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, part) => o?.[part], obj);
}

// Empty means "use the fallback" for everything except plain text and secrets,
// where empty is a real value (for example, a cleared key).
function effective(def, raw) {
  if (raw === undefined || raw === null) return def.fallback;
  if (raw === '' && def.kind !== 'text' && def.kind !== 'secret') return def.fallback;
  return raw;
}

// Copies the stored values into the in-memory `config` object.
// Secrets that can't be decrypted (wrong or missing CONFIG_ENCRYPTION_KEY) load as empty.
export function applyStoredValues(rows) {
  const unreadable = new Set();
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const stored = rows.get(key);
    let value;
    if (SECRET_KINDS.has(def.kind)) {
      try {
        value = stored ? decryptSecret(stored) : def.fallback;
      } catch {
        unreadable.add(key);
        value = '';
      }
    } else {
      value = effective(def, stored);
    }
    if (def.kind === 'int') value = Number(value);
    setPath(config, key, value);
  }
  // Square's webhook URL defaults to the public URL when left blank.
  if (!config.square.webhookUrl) {
    config.square.webhookUrl = `${config.publicUrl.replace(/\/$/, '')}/api/payments/square/webhook`;
  }
  return unreadable;
}

let unreadableSecrets = new Set();

// Loads settings from the database. The first time a key has no row, its value
// is copied in from the matching environment variable (if one is set).
export async function initRuntimeConfig() {
  let rows = await prisma.configValue.findMany();
  let stored = new Map(rows.map((r) => [r.key, r.value]));

  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    if (stored.has(key)) continue;
    const fromEnv = process.env[def.env];
    if (fromEnv === undefined || fromEnv === '') continue;
    if (SECRET_KINDS.has(def.kind) && !isEncryptionReady()) {
      console.warn(`[config] ${def.env} is set but CONFIG_ENCRYPTION_KEY is missing, so it was not imported.`);
      continue;
    }
    const check = validateValue(key, fromEnv);
    if (check.error) {
      console.warn(`[config] ${def.env} ignored: ${check.error}`);
      continue;
    }
    await prisma.configValue.create({
      data: { key, value: SECRET_KINDS.has(def.kind) ? encryptSecret(check.value) : check.value },
    });
  }

  rows = await prisma.configValue.findMany();
  stored = new Map(rows.map((r) => [r.key, r.value]));
  unreadableSecrets = applyStoredValues(stored);
  return config;
}

// Returns { value } with the normalized value, or { error } with a message.
export function validateValue(key, input) {
  const def = SETTING_DEFS[key];
  if (!def) return { error: `Unknown setting: ${key}` };
  const text = typeof input === 'string' ? input.trim() : String(input ?? '').trim();

  if (SECRET_KINDS.has(def.kind)) return { value: text };
  if (text === '' && def.optional) return { value: '' };
  if (text === '') return { value: '' };

  switch (def.kind) {
    case 'url': {
      let url;
      try {
        url = new URL(text);
      } catch {
        return { error: `${key} must be a full address starting with http:// or https://` };
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { error: `${key} must start with http:// or https://` };
      }
      return { value: text.replace(/\/$/, '') };
    }
    case 'int': {
      const n = Number(text);
      if (!Number.isInteger(n) || n < def.min || n > def.max) {
        return { error: `${key} must be a whole number from ${def.min} to ${def.max}` };
      }
      return { value: String(n) };
    }
    case 'enum':
      if (!def.values.includes(text)) return { error: `${key} must be one of: ${def.values.join(', ')}` };
      return { value: text };
    default:
      return { value: text };
  }
}

// Saves changed settings. `allowedGroups` limits which groups this caller may change.
// Keys with `undefined` are skipped. A secret saved as an empty string is cleared.
export async function saveRuntimeSettings(updates, allowedGroups) {
  const writes = [];
  for (const [key, input] of Object.entries(updates)) {
    if (input === undefined) continue;
    const def = SETTING_DEFS[key];
    if (!def) return { error: `Unknown setting: ${key}` };
    if (!allowedGroups.includes(def.group)) return { error: `You can't change ${key} with your role` };

    const check = validateValue(key, input);
    if (check.error) return { error: check.error };

    if (SECRET_KINDS.has(def.kind) && check.value !== '') {
      if (!isEncryptionReady()) {
        return { error: 'Secrets can only be saved once CONFIG_ENCRYPTION_KEY is set in the project .env file' };
      }
      writes.push({ key, value: encryptSecret(check.value) });
    } else {
      writes.push({ key, value: check.value });
    }
  }

  await prisma.$transaction(
    writes.map((w) =>
      prisma.configValue.upsert({ where: { key: w.key }, create: w, update: { value: w.value } }),
    ),
  );

  // Reload everything so derived values (like the Square webhook URL) stay in step.
  await initRuntimeConfig();
  return { ok: true };
}

// What the admin UI may see. Secret values are never returned, only whether one is saved.
export function runtimeSettingsView(allowedGroups) {
  const values = {};
  const secretsSet = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    if (!allowedGroups.includes(def.group)) continue;
    if (SECRET_KINDS.has(def.kind)) {
      secretsSet[key] = Boolean(getPath(config, key)) && !unreadableSecrets.has(key);
    } else {
      values[key] = getPath(config, key);
    }
  }
  return {
    values,
    secretsSet,
    unreadable: [...unreadableSecrets].filter((k) => allowedGroups.includes(SETTING_DEFS[k].group)),
    encryptionReady: isEncryptionReady(),
  };
}
