import { SAML } from '@node-saml/node-saml';
import { prisma, rawPrisma } from '../db.js';
import { siteConfig } from './runtimeConfig.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../tenancy/context.js';

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

export async function updateSamlConfig(data) {
  const { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision } = data;
  const tenantId = currentTenantId();
  return prisma.samlConfig.upsert({
    where: { tenantId },
    create: { tenantId, enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision },
    update: { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision },
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
    // Accept either a signed assertion or a signed top-level response --
    // most IdPs (Okta, Azure AD, etc.) sign only the assertion by default,
    // and node-saml's wantAuthnResponseSigned otherwise defaults to true,
    // which would reject that extremely common configuration outright.
    // node-saml always requires at least one of the two to be signed.
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
  });
}
