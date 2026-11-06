import { prisma, rawPrisma } from '../db.js';
import { encryptSecret, decryptSecret, isEncryptionReady } from '../utils/secretBox.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import { looksLikeEmail } from './contact.js';

export const EMAIL_PROVIDERS = ['NONE', 'SMTP', 'SES', 'POSTMARK', 'SENDGRID'];
export const SMS_PROVIDERS = ['NONE', 'TWILIO'];

// Every per-site setting. `env` is the old variable name, read once to seed the
// default site when no row exists yet. `kind` decides validation and storage:
// url | int | enum | text | secret. `group` decides which admin page (and
// permission) can change it.
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
  // Optional: empty means "derive from the public URL and this site's path".
  'square.webhookUrl': { env: 'SQUARE_WEBHOOK_URL', fallback: '', kind: 'url', group: 'square', optional: true },

  // Notification integrations. There are no environment variables for these: they are
  // set in the admin pages only.
  'email.provider': { env: null, fallback: 'NONE', kind: 'enum', values: EMAIL_PROVIDERS, group: 'email' },
  'email.fromAddress': { env: null, fallback: '', kind: 'email', group: 'email' },
  'email.fromName': { env: null, fallback: '', kind: 'text', group: 'email' },
  'email.smtp.host': { env: null, fallback: '', kind: 'text', group: 'email' },
  'email.smtp.port': { env: null, fallback: '587', kind: 'int', min: 1, max: 65535, group: 'email' },
  'email.smtp.secure': { env: null, fallback: 'STARTTLS', kind: 'enum', values: ['STARTTLS', 'TLS', 'NONE'], group: 'email' },
  'email.smtp.username': { env: null, fallback: '', kind: 'text', group: 'email' },
  'email.smtp.password': { env: null, fallback: '', kind: 'secret', group: 'email' },
  'email.ses.region': { env: null, fallback: '', kind: 'text', group: 'email' },
  'email.ses.accessKeyId': { env: null, fallback: '', kind: 'text', group: 'email' },
  'email.ses.secretAccessKey': { env: null, fallback: '', kind: 'secret', group: 'email' },
  'email.postmark.serverToken': { env: null, fallback: '', kind: 'secret', group: 'email' },
  'email.sendgrid.apiKey': { env: null, fallback: '', kind: 'secret', group: 'email' },

  'sms.provider': { env: null, fallback: 'NONE', kind: 'enum', values: SMS_PROVIDERS, group: 'sms' },
  'sms.twilio.accountSid': { env: null, fallback: '', kind: 'text', group: 'sms' },
  'sms.twilio.authToken': { env: null, fallback: '', kind: 'secret', group: 'sms' },
  // A Twilio phone number (+...), or a Messaging Service SID (starts with MG).
  'sms.twilio.sender': { env: null, fallback: '', kind: 'text', group: 'sms' },
};

const SECRET_KINDS = new Set(['secret']);

function setPath(obj, path, value) {
  const parts = path.split('.');
  let target = obj;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part];
  }
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

// Where a site's API routes live. The default site uses the un-prefixed paths.
export function sitePathPrefix(slug) {
  return !slug || slug === DEFAULT_TENANT_ID ? '/api' : `/api/t/${slug}`;
}

// Builds one site's resolved settings from its stored rows. Secrets that can't
// be decrypted (wrong or missing CONFIG_ENCRYPTION_KEY) load as empty and are
// reported as unreadable.
function buildSite(stored, slug) {
  const config = { stripe: {}, braintree: {}, square: {}, email: {}, sms: {} };
  const unreadable = new Set();
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const raw = stored.get(key);
    let value;
    if (SECRET_KINDS.has(def.kind)) {
      try {
        value = raw ? decryptSecret(raw) : def.fallback;
      } catch {
        unreadable.add(key);
        value = '';
      }
    } else {
      value = effective(def, raw);
    }
    if (def.kind === 'int') value = Number(value);
    setPath(config, key, value);
  }
  // Square's webhook URL defaults to this site's public address.
  if (!config.square.webhookUrl) {
    config.square.webhookUrl = `${config.publicUrl.replace(/\/$/, '')}${sitePathPrefix(slug)}/payments/square/webhook`;
  }
  return { slug, config, unreadable };
}

// Loaded sites, keyed by tenant id.
const sites = new Map();

// The current site's resolved settings. A site that isn't loaded yet gets the
// fresh-install defaults, so nothing reads another site's values.
export function siteConfig(tenantId = currentTenantId()) {
  const site = sites.get(tenantId);
  if (site) return site.config;
  return buildSite(new Map(), tenantId).config;
}

function currentSite() {
  return sites.get(currentTenantId()) ?? buildSite(new Map(), currentTenantId());
}

// Loads one site's settings from the database. Returns its resolved config, or
// null if the site no longer exists.
export async function loadSiteConfig(tenantId) {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) {
    sites.delete(tenantId);
    return null;
  }
  const rows = await rawPrisma.configValue.findMany({ where: { tenantId } });
  const site = buildSite(new Map(rows.map((r) => [r.key, r.value])), tenant.slug);
  sites.set(tenantId, site);
  return site.config;
}

// Loads a site's settings if they aren't in memory yet. Called where a request
// or message first enters a site.
export async function ensureSiteLoaded(tenantId) {
  if (!sites.has(tenantId)) await loadSiteConfig(tenantId);
}

// Every loaded site's CORS origin, for the CORS check.
export function allowedOrigins() {
  return new Set([...sites.values()].map((site) => site.config.corsOrigin));
}

// Loads every site. The first time a key has no row in the default site, its
// value is copied in from the matching environment variable (if one is set).
// Environment values are instance-wide, so they only ever seed the default site.
export async function initRuntimeConfig() {
  const defaultRows = await rawPrisma.configValue.findMany({ where: { tenantId: DEFAULT_TENANT_ID } });
  const existing = new Set(defaultRows.map((r) => r.key));

  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    if (existing.has(key)) continue;
    const fromEnv = def.env ? process.env[def.env] : undefined;
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
    await rawPrisma.configValue.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        key,
        value: SECRET_KINDS.has(def.kind) ? encryptSecret(check.value) : check.value,
      },
    });
  }

  await loadAllSites();
  return siteConfig(DEFAULT_TENANT_ID);
}

// Reloads every site from the database. Drops sites that no longer exist.
export async function loadAllSites() {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  const ids = new Set(tenants.map((t) => t.id));
  for (const id of [...sites.keys()]) {
    if (!ids.has(id)) sites.delete(id);
  }
  for (const tenant of tenants) await loadSiteConfig(tenant.id);
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
    case 'email':
      if (!looksLikeEmail(text)) return { error: `${key} must be an e-mail address, such as no-reply@example.com` };
      return { value: text };
    default:
      return { value: text };
  }
}

// Saves changed settings for the current site. `allowedGroups` limits which
// groups this caller may change. Keys with `undefined` are skipped. A secret
// saved as an empty string is cleared.
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

  const tenantId = currentTenantId();
  await prisma.$transaction(
    writes.map((w) =>
      prisma.configValue.upsert({
        where: { tenantId_key: { tenantId, key: w.key } },
        create: { key: w.key, value: w.value },
        update: { value: w.value },
      }),
    ),
  );

  // Reload this site so derived values (like the Square webhook URL) stay in step.
  await loadSiteConfig(tenantId);
  return { ok: true };
}

// What the admin UI may see for the current site. Secret values are never
// returned, only whether one is saved.
export function runtimeSettingsView(allowedGroups) {
  const site = currentSite();
  const values = {};
  const secretsSet = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    if (!allowedGroups.includes(def.group)) continue;
    if (SECRET_KINDS.has(def.kind)) {
      secretsSet[key] = Boolean(getPath(site.config, key)) && !site.unreadable.has(key);
    } else {
      values[key] = getPath(site.config, key);
    }
  }
  return {
    values,
    secretsSet,
    unreadable: [...site.unreadable].filter((k) => allowedGroups.includes(SETTING_DEFS[k].group)),
    encryptionReady: isEncryptionReady(),
  };
}
