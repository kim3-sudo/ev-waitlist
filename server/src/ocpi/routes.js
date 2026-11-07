import { Router } from 'express';
import { prisma, rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { currentRoaming } from '../services/roaming.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { encryptSecret } from '../utils/secretBox.js';
import { ok, fail, paginate, STATUS } from './envelope.js';
import { newToken, hashToken, tokenFromHeader } from './tokens.js';
import { discoverEndpoints } from './client.js';
import { locationOf, tariffOf, sessionOf, cdrOf, stationIsPublishable, TARIFF_ID } from './mappers.js';
import { enqueue } from './outbox.js';
import { runCommand } from './commands.js';
import { getPaymentSettings } from '../services/payments/paymentSettingsService.js';
import { priceAdjusterForSession } from '../services/payments/priceRuleService.js';

// The OCPI interface of one site, mounted at /ocpi/<slug>. It works only while
// roaming is on for the site.
export const ocpiRouter = Router({ mergeParams: true });

const VERSION = '2.2.1';
const TOKEN_TYPES = ['RFID', 'APP_USER', 'AD_HOC_USER', 'OTHER'];
const WHITELISTS = ['ALWAYS', 'ALLOWED', 'ALLOWED_OFFLINE', 'NEVER'];

function base(req) {
  return `${siteConfig().publicUrl}/ocpi/${req.tenantSlug}`;
}

async function operatorOrNull() {
  const op = await rawPrisma.operator.findUnique({ where: { id: 'singleton' } });
  return op?.countryCode && op?.partyId ? op : null;
}

// Refuses everything while roaming is off for the site.
ocpiRouter.use(async (req, res, next) => {
  const roaming = await currentRoaming();
  if (!roaming.enabled) return fail(res, 403, STATUS.CLIENT_ERROR, 'Roaming is not enabled for this site');
  next();
});

// Accepts the registration token (before the handshake) or the partner's own token.
async function anyPartnerAuth(req, res, next) {
  const plain = tokenFromHeader(req.headers.authorization);
  if (!plain) return fail(res, 401, STATUS.CLIENT_ERROR, 'Missing or malformed Authorization header');
  const hash = hashToken(plain);
  const partner = await rawPrisma.ocpiPartner.findFirst({
    where: { OR: [{ ourTokenHash: hash }, { registrationTokenHash: hash }] },
  });
  if (!partner || partner.tenantId !== currentTenantId() || partner.status === 'REVOKED') {
    return fail(res, 401, STATUS.CLIENT_ERROR, 'Unknown or revoked token');
  }
  req.partner = partner;
  next();
}

// Only the partner's own token (after the handshake).
async function activePartnerAuth(req, res, next) {
  const plain = tokenFromHeader(req.headers.authorization);
  if (!plain) return fail(res, 401, STATUS.CLIENT_ERROR, 'Missing or malformed Authorization header');
  const partner = await rawPrisma.ocpiPartner.findUnique({ where: { ourTokenHash: hashToken(plain) } });
  if (!partner || partner.tenantId !== currentTenantId() || partner.status !== 'ACTIVE') {
    return fail(res, 401, STATUS.CLIENT_ERROR, 'Unknown or inactive token');
  }
  req.partner = partner;
  next();
}

// Only the registration token (the first POST to credentials).
async function registrationAuth(req, res, next) {
  const plain = tokenFromHeader(req.headers.authorization);
  if (!plain) return fail(res, 401, STATUS.CLIENT_ERROR, 'Missing or malformed Authorization header');
  const partner = await rawPrisma.ocpiPartner.findUnique({ where: { registrationTokenHash: hashToken(plain) } });
  if (!partner || partner.tenantId !== currentTenantId() || partner.status !== 'PENDING') {
    return fail(res, 401, STATUS.CLIENT_ERROR, 'Unknown or already used registration token');
  }
  req.partner = partner;
  next();
}

ocpiRouter.get('/versions', anyPartnerAuth, (req, res) => {
  ok(res, [{ version: VERSION, url: `${base(req)}/${VERSION}` }]);
});

ocpiRouter.get(`/${VERSION}`, anyPartnerAuth, (req, res) => {
  const root = `${base(req)}/${VERSION}`;
  ok(res, {
    version: VERSION,
    endpoints: [
      'credentials',
      'locations',
      'tariffs',
      'sessions',
      'cdrs',
      'tokens',
      'commands',
    ].map((identifier) => ({ identifier, url: `${root}/${identifier}` })),
  });
});

// Our credentials, as the partner needs them. The token is only returned once, at
// the handshake, so it is not repeated here.
async function ourCredentials(req, op, tenantName, token) {
  return {
    url: `${base(req)}/versions`,
    ...(token ? { token } : {}),
    roles: [
      {
        role: 'CPO',
        party_id: op.partyId,
        country_code: op.countryCode,
        business_details: { name: op.name || tenantName },
      },
    ],
  };
}

// Stations that can be published: coordinates, and complete connector details.
async function publishedStations() {
  const stations = await prisma.station.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    include: { connectors: true },
    orderBy: { name: 'asc' },
  });
  return stations.filter(stationIsPublishable);
}

async function queueFullSync(partnerId) {
  for (const station of await publishedStations()) await enqueue(partnerId, 'LOCATION', station.id);
  await enqueue(partnerId, 'TARIFFS', TARIFF_ID);
}

const credentials = `/${VERSION}/credentials`;

// The handshake. The partner posts its credentials with the registration token we
// issued, and gets back ours, with a token it must use from now on.
ocpiRouter.post(credentials, registrationAuth, async (req, res) => {
  const body = req.body ?? {};
  const role = Array.isArray(body.roles) ? body.roles.find((r) => r.role === 'EMSP') : null;
  if (!body.url || !body.token || !role?.country_code || !role?.party_id) {
    return fail(res, 400, STATUS.INVALID_PARAMETERS, 'Credentials need url, token, and an EMSP role with country_code and party_id');
  }
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');

  // Check the partner's endpoints before accepting the handshake, so a failed
  // attempt can be retried with the same registration token.
  const discovered = await discoverEndpoints(body.url, body.token);
  if (!discovered.ok) {
    await prisma.ocpiPartner.update({ where: { id: req.partner.id }, data: { lastError: discovered.error } });
    return fail(res, 400, STATUS.UNABLE_TO_USE_CLIENT, discovered.error);
  }

  const ourToken = newToken();
  await prisma.ocpiPartner.update({
    where: { id: req.partner.id },
    data: {
      status: 'ACTIVE',
      registrationTokenHash: null,
      ourTokenHash: hashToken(ourToken),
      theirVersionsUrl: body.url,
      theirTokenEnc: encryptSecret(body.token),
      theirCountryCode: role.country_code,
      theirPartyId: role.party_id,
      endpoints: JSON.stringify(discovered.endpoints),
      lastError: null,
    },
  });
  await queueFullSync(req.partner.id);

  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { name: true } });
  const creds = await ourCredentials(req, op, tenant?.name ?? '', ourToken);
  return ok(res, creds, 201);
});

ocpiRouter.get(credentials, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { name: true } });
  ok(res, await ourCredentials(req, op, tenant?.name ?? ''));
});

// The partner rotates its token or changes its details.
ocpiRouter.put(credentials, activePartnerAuth, async (req, res) => {
  const body = req.body ?? {};
  const role = Array.isArray(body.roles) ? body.roles.find((r) => r.role === 'EMSP') : null;
  if (!body.url || !body.token || !role?.country_code || !role?.party_id) {
    return fail(res, 400, STATUS.INVALID_PARAMETERS, 'Credentials need url, token, and an EMSP role');
  }
  const discovered = await discoverEndpoints(body.url, body.token);
  if (!discovered.ok) return fail(res, 400, STATUS.UNABLE_TO_USE_CLIENT, discovered.error);
  await prisma.ocpiPartner.update({
    where: { id: req.partner.id },
    data: {
      theirVersionsUrl: body.url,
      theirTokenEnc: encryptSecret(body.token),
      theirCountryCode: role.country_code,
      theirPartyId: role.party_id,
      endpoints: JSON.stringify(discovered.endpoints),
    },
  });
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { name: true } });
  ok(res, await ourCredentials(req, op, tenant?.name ?? ''));
});

// The partner stops using us: its token stops working.
ocpiRouter.delete(credentials, activePartnerAuth, async (req, res) => {
  await prisma.ocpiPartner.update({
    where: { id: req.partner.id },
    data: { status: 'REVOKED', ourTokenHash: null },
  });
  ok(res, undefined);
});

ocpiRouter.get(`/${VERSION}/locations`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const stations = await publishedStations();
  const page = paginate(req, res, stations);
  ok(res, page.map((s) => locationOf(op, s)));
});

ocpiRouter.get(`/${VERSION}/locations/:countryCode/:partyId/:locationId`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  const station = await prisma.station.findUnique({ where: { id: req.params.locationId }, include: { connectors: true } });
  if (!op || !station || !stationIsPublishable(station)) return fail(res, 404, STATUS.UNKNOWN_LOCATION, 'Unknown location');
  ok(res, locationOf(op, station));
});

ocpiRouter.get(`/${VERSION}/tariffs`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const settings = await getPaymentSettings();
  ok(res, paginate(req, res, [tariffOf(op, settings)]));
});

ocpiRouter.get(`/${VERSION}/tariffs/:countryCode/:partyId/:tariffId`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op || req.params.tariffId !== TARIFF_ID) return fail(res, 404, STATUS.CLIENT_ERROR, 'Unknown tariff');
  ok(res, tariffOf(op, await getPaymentSettings()));
});

// Sessions and CDRs are the ones for this partner's drivers.
ocpiRouter.get(`/${VERSION}/sessions`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const settings = await getPaymentSettings();
  const txs = await prisma.transaction.findMany({
    where: { partnerId: req.partner.id },
    include: { station: { include: { connectors: true } } },
    orderBy: { startedAt: 'desc' },
  });
  const tokens = await prisma.ocpiToken.findMany({ where: { partnerId: req.partner.id } });
  const byUid = new Map(tokens.map((t) => [t.uid, t]));
  const page = paginate(req, res, txs);
  ok(res, page.map((tx) => sessionOf(op, tx.station, tx, byUid.get(tx.idTag), settings)));
});

ocpiRouter.get(`/${VERSION}/cdrs`, activePartnerAuth, async (req, res) => {
  const op = await operatorOrNull();
  if (!op) return fail(res, 503, STATUS.UNABLE_TO_USE_CLIENT, 'The operator party is not set for this site');
  const settings = await getPaymentSettings();
  const txs = await prisma.transaction.findMany({
    where: { partnerId: req.partner.id, stoppedAt: { not: null } },
    include: { station: { include: { connectors: true } } },
    orderBy: { startedAt: 'desc' },
  });
  const tokens = await prisma.ocpiToken.findMany({ where: { partnerId: req.partner.id } });
  const byUid = new Map(tokens.map((t) => [t.uid, t]));
  const page = paginate(req, res, txs);
  const cdrs = [];
  for (const tx of page) {
    const adjustmentAt = await priceAdjusterForSession({
      tenantId: tx.tenantId,
      stationId: tx.stationId,
      zoneId: tx.station.zoneId,
      connectorId: tx.connectorId,
      startedAt: tx.startedAt,
      stoppedAt: tx.stoppedAt,
    });
    cdrs.push(cdrOf(op, tx.station, tx, byUid.get(tx.idTag), settings, adjustmentAt));
  }
  ok(res, cdrs);
});

// The partner pushes its drivers' tokens to us.
function tokenFields(body, partner) {
  const issue = [];
  if (body.country_code !== partner.theirCountryCode || body.party_id !== partner.theirPartyId) {
    issue.push('country_code and party_id must be the partner\'s own');
  }
  if (typeof body.uid !== 'string' || !body.uid) issue.push('uid is required');
  if (body.type !== undefined && !TOKEN_TYPES.includes(body.type)) issue.push('type is not valid');
  if (body.whitelist !== undefined && !WHITELISTS.includes(body.whitelist)) issue.push('whitelist is not valid');
  if (body.last_updated && Number.isNaN(Date.parse(body.last_updated))) issue.push('last_updated is not a date');
  return issue;
}

ocpiRouter.put(`/${VERSION}/tokens/:countryCode/:partyId/:uid`, activePartnerAuth, async (req, res) => {
  const body = req.body ?? {};
  const issues = tokenFields({ ...body, uid: body.uid ?? req.params.uid }, req.partner);
  if (issues.length) return fail(res, 400, STATUS.INVALID_PARAMETERS, issues.join('; '));
  if (body.uid !== req.params.uid) return fail(res, 400, STATUS.INVALID_PARAMETERS, 'uid in the body must match the URL');

  const data = {
    country: body.country_code,
    party: body.party_id,
    type: body.type ?? 'OTHER',
    contractId: body.contract_id ?? '',
    valid: body.valid !== false,
    whitelist: body.whitelist ?? 'ALLOWED',
    lastUpdated: body.last_updated ? new Date(body.last_updated) : new Date(),
  };
  await prisma.ocpiToken.upsert({
    where: { partnerId_uid: { partnerId: req.partner.id, uid: req.params.uid } },
    create: { partnerId: req.partner.id, uid: req.params.uid, ...data },
    update: data,
  });
  ok(res, undefined);
});

ocpiRouter.patch(`/${VERSION}/tokens/:countryCode/:partyId/:uid`, activePartnerAuth, async (req, res) => {
  const existing = await prisma.ocpiToken.findFirst({ where: { partnerId: req.partner.id, uid: req.params.uid } });
  if (!existing) return fail(res, 404, STATUS.UNKNOWN_LOCATION, 'Unknown token');
  const body = req.body ?? {};
  if (body.whitelist !== undefined && !WHITELISTS.includes(body.whitelist)) {
    return fail(res, 400, STATUS.INVALID_PARAMETERS, 'whitelist is not valid');
  }
  await prisma.ocpiToken.update({
    where: { id: existing.id },
    data: {
      ...(body.valid !== undefined && { valid: body.valid === true }),
      ...(body.whitelist !== undefined && { whitelist: body.whitelist }),
      ...(body.type !== undefined && TOKEN_TYPES.includes(body.type) && { type: body.type }),
      ...(body.contract_id !== undefined && { contractId: body.contract_id }),
      lastUpdated: new Date(),
    },
  });
  ok(res, undefined);
});

// Commands from the partner. The answer comes back now; the outcome is posted later
// to response_url.
ocpiRouter.post(`/${VERSION}/commands/:command`, activePartnerAuth, async (req, res) => {
  const result = await runCommand(req.partner, req.params.command, req.body);
  if (result.unknown) return fail(res, 404, STATUS.CLIENT_ERROR, 'Unknown command');
  if (result.unknownLocation) return fail(res, 404, STATUS.UNKNOWN_LOCATION, 'Unknown location');
  ok(res, result.data);
});
