import { SAML } from '@node-saml/node-saml';
import { prisma, rawPrisma } from '../db.js';
import { siteConfig } from './runtimeConfig.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import { roleExists } from './roleService.js';

// The NameID formats an admin can choose, by the short name stored in SamlConfig.nameIdFormat.
export const NAME_ID_FORMATS = {
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
};

const MAX_GROUP_MAPPINGS = 100;

// The default site keeps the original paths, so an identity provider configured
// before multi-site support keeps working. Other sites get their own path.
export function samlPathPrefix(slug) {
  return !slug || slug === DEFAULT_TENANT_ID ? '/api/auth/saml' : `/api/t/${slug}/auth/saml`;
}

// Functions, not constants: the public URL can change in the admin UI.
export const spEntityId = (slug) => `${siteConfig().publicUrl}${samlPathPrefix(slug)}/metadata`;
export const spCallbackUrl = (slug) => `${siteConfig().publicUrl}${samlPathPrefix(slug)}/acs`;

// The slug of the site the current request works in.
export async function currentSiteSlug() {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { slug: true } });
  return tenant?.slug ?? DEFAULT_TENANT_ID;
}

export async function getSamlConfig() {
  const tenantId = currentTenantId();
  const existing = await prisma.samlConfig.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.samlConfig.create({ data: { tenantId } });
}

// Parses the stored JSON list of { group, role } mappings. Bad JSON means no mappings.
export function parseGroupRoleMappings(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((m) => typeof m?.group === 'string' && typeof m?.role === 'string')
      : [];
  } catch {
    return [];
  }
}

// Validates a settings payload. Returns { value } (only the fields given) or { error }.
export async function validateSamlInput(body) {
  const { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision } = body;
  const { nameIdFormat, groupAttribute, groupRoleMappings, defaultRole } = body;
  const value = { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision };

  if (nameIdFormat !== undefined) {
    if (!Object.hasOwn(NAME_ID_FORMATS, nameIdFormat)) {
      return { error: 'NameID format must be emailAddress, persistent, or unspecified' };
    }
    value.nameIdFormat = nameIdFormat;
  }

  if (groupAttribute !== undefined) {
    const trimmed = typeof groupAttribute === 'string' ? groupAttribute.trim() : '';
    if (trimmed.length > 200) return { error: 'Group attribute name is too long' };
    value.groupAttribute = trimmed || null;
  }

  if (groupRoleMappings !== undefined) {
    if (!Array.isArray(groupRoleMappings)) return { error: 'groupRoleMappings must be a list' };
    if (groupRoleMappings.length > MAX_GROUP_MAPPINGS) {
      return { error: `At most ${MAX_GROUP_MAPPINGS} group mappings are allowed` };
    }
    const cleaned = [];
    for (const mapping of groupRoleMappings) {
      const group = typeof mapping?.group === 'string' ? mapping.group.trim() : '';
      const role = typeof mapping?.role === 'string' ? mapping.role.trim() : '';
      if (!group || group.length > 200) return { error: 'Each group mapping needs a group name of up to 200 characters' };
      if (!role) return { error: `Choose a role for group "${group}"` };
      if (!(await roleExists(role))) return { error: `Unknown role: ${role}` };
      cleaned.push({ group, role });
    }
    value.groupRoleMappings = JSON.stringify(cleaned);
  }

  if (defaultRole !== undefined) {
    if (defaultRole === null || defaultRole === '') {
      value.defaultRole = null;
    } else if (typeof defaultRole !== 'string' || !(await roleExists(defaultRole))) {
      return { error: `Unknown role: ${defaultRole}` };
    } else {
      value.defaultRole = defaultRole;
    }
  }

  return { value };
}

export async function updateSamlConfig(value) {
  const tenantId = currentTenantId();
  return prisma.samlConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...value },
    update: value,
  });
}

// Builds a NodeSAML client from the persisted IdP config. Returns null when
// SAML isn't configured/enabled yet.
export async function buildSamlClient() {
  const samlConfig = await getSamlConfig();
  if (!samlConfig.enabled || !samlConfig.idpSsoUrl || !samlConfig.idpCertificate) return null;

  const slug = await currentSiteSlug();
  return new SAML({
    issuer: spEntityId(slug),
    callbackUrl: spCallbackUrl(slug),
    entryPoint: samlConfig.idpSsoUrl,
    idpCert: samlConfig.idpCertificate,
    // The NameID format we ask the IdP for. The assertion's own format is not enforced.
    identifierFormat: NAME_ID_FORMATS[samlConfig.nameIdFormat] ?? NAME_ID_FORMATS.emailAddress,
    // Accept either a signed assertion or a signed top-level response --
    // most IdPs (Okta, Azure AD, etc.) sign only the assertion by default,
    // and node-saml's wantAuthnResponseSigned otherwise defaults to true,
    // which would reject that extremely common configuration outright.
    // node-saml always requires at least one of the two to be signed.
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
  });
}

// The group names in an assertion, from the configured attribute.
export function groupsFromProfile(profile, attributeName) {
  const raw = profile.attributes?.[attributeName];
  const values = raw === undefined ? [] : [].concat(raw);
  return values.filter((v) => typeof v === 'string').map((v) => v.trim());
}

// The role an assertion's groups give. Undefined when group roles are off, null
// when no mapped group matches and the default role is empty (deny), otherwise a role name.
export function roleForGroups(groups, samlConfig) {
  if (!samlConfig.groupAttribute) return undefined;
  const match = parseGroupRoleMappings(samlConfig.groupRoleMappings).find((m) => groups.includes(m.group));
  return match ? match.role : samlConfig.defaultRole;
}

// Finds or creates the admin account for a validated SAML assertion, and
// applies group-based role. Returns { admin } or { status, message }.
export async function resolveSsoLogin(profile, samlConfig) {
  const usesEmail = samlConfig.nameIdFormat === 'emailAddress';
  const nameId = profile.nameID;
  // With an emailAddress NameID the NameID is the email, as before. Otherwise the
  // NameID is a stable identifier and the email comes from the assertion.
  const email = profile.email || profile.mail || (usesEmail ? nameId : null);
  const identity = usesEmail ? email : nameId;
  if (!identity) return { status: 401, message: 'SAML assertion did not include a user identifier' };

  const groupRole = roleForGroups(
    samlConfig.groupAttribute ? groupsFromProfile(profile, samlConfig.groupAttribute) : [],
    samlConfig,
  );
  if (groupRole === null) {
    return { status: 403, message: 'Your account is not in a group that has access to this site' };
  }

  let admin = usesEmail
    ? await prisma.admin.findUnique({ where: { email } })
    : await prisma.admin.findFirst({ where: { samlNameId: identity } });

  if (!admin && !usesEmail && email) {
    // First SSO login for an account that already exists by email: link it to this identity.
    const byEmail = await prisma.admin.findUnique({ where: { email } });
    if (byEmail?.samlNameId && byEmail.samlNameId !== identity) {
      return { status: 401, message: `The account for ${email} is linked to a different SSO identity` };
    }
    if (byEmail) admin = await prisma.admin.update({ where: { id: byEmail.id }, data: { samlNameId: identity } });
  }

  if (!admin) {
    if (!samlConfig.autoProvision) {
      return { status: 401, message: `No account found for ${email ?? identity} and auto-provisioning is disabled` };
    }
    if (!email) return { status: 401, message: 'SAML assertion did not include an email address' };
    // A new account takes its group role, or viewer when group roles are off.
    const role = groupRole ?? 'VIEWER';
    admin = await prisma.admin.create({
      data: { email, passwordHash: null, role, samlNameId: usesEmail ? null : identity },
    });
  } else if (groupRole !== undefined && groupRole !== admin.role) {
    // Group membership is the source of truth for SSO users, so the role follows it on every login.
    admin = await prisma.admin.update({ where: { id: admin.id }, data: { role: groupRole } });
  }

  return { admin };
}
