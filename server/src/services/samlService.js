import { SAML } from '@node-saml/node-saml';
import { prisma } from '../db.js';
import { config } from '../config.js';

const SAML_CONFIG_ID = 'singleton';

export const spEntityId = `${config.publicUrl}/api/auth/saml/metadata`;
export const spCallbackUrl = `${config.publicUrl}/api/auth/saml/acs`;

export async function getSamlConfig() {
  const existing = await prisma.samlConfig.findUnique({ where: { id: SAML_CONFIG_ID } });
  if (existing) return existing;
  return prisma.samlConfig.create({ data: { id: SAML_CONFIG_ID } });
}

export async function updateSamlConfig(data) {
  const { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision } = data;
  return prisma.samlConfig.upsert({
    where: { id: SAML_CONFIG_ID },
    create: { id: SAML_CONFIG_ID, enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision },
    update: { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision },
  });
}

// Builds a NodeSAML client from the persisted IdP config. Returns null when
// SAML isn't configured/enabled yet.
export async function buildSamlClient() {
  const samlConfig = await getSamlConfig();
  if (!samlConfig.enabled || !samlConfig.idpSsoUrl || !samlConfig.idpCertificate) return null;

  return new SAML({
    issuer: spEntityId,
    callbackUrl: spCallbackUrl,
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
