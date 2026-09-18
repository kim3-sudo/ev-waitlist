// A minimal, self-signed SAML 2.0 Identity Provider, for exercising this
// app's SAML service provider (see src/auth/saml.routes.js) without a real
// external IdP.
//
// Run standalone:
//   node src/simulator/samlIdp.js [port]
// Then, in the admin "Single sign-on" tab, configure:
//   IdP entity ID:   printed at startup (also served at GET /metadata)
//   IdP SSO URL:     http://localhost:<port>/sso
//   IdP certificate: printed at startup (also served as plain text at GET /cert)
// Enable SSO, save, and use the "Sign in with SSO" button on the login page --
// it will redirect here, where you can pick an email and get posted straight
// back to this app's ACS endpoint with a real signed assertion.
//
// The signing key/cert pair in ./fixtures is a static, checked-in test
// fixture -- it is not a secret and must never be used for anything beyond
// local testing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { SignedXml } from 'xml-crypto';
import { spEntityId, spCallbackUrl } from '../services/samlService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const idpCertPem = readFileSync(path.join(__dirname, 'fixtures/idp-cert.pem'), 'utf8');
export const idpKeyPem = readFileSync(path.join(__dirname, 'fixtures/idp-key.pem'), 'utf8');
export const idpEntityId = 'https://ev-waitlist-test-idp.local/metadata';

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function isoOffset(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
}

function uniqueId() {
  // SAML IDs must not start with a digit -- prefix with an underscore.
  return `_${randomBytes(16).toString('hex')}`;
}

function signAssertion(assertionXml, assertionId, signingKeyPem) {
  const sig = new SignedXml({ privateKey: signingKeyPem, publicCert: idpCertPem });
  sig.addReference({
    xpath: `//*[@ID='${assertionId}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  // Places <Signature> right after <Issuer>, as a direct child of
  // <Assertion> -- the placement node-saml's verifier expects.
  sig.computeSignature(assertionXml, {
    location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
  });
  return sig.getSignedXml();
}

// Builds a fully signed SAMLResponse (base64-encoded, ready to drop into the
// SAML POST binding's `SAMLResponse` form field) asserting `email` for the
// given SP. Exported for direct use in integration tests, bypassing the
// browser/HTTP round trip through the simulator app below.
export function buildSignedSamlResponse({
  spEntityId: audience = spEntityId,
  acsUrl = spCallbackUrl,
  email,
  nameId = email,
  issuer = idpEntityId,
  signed = true,
  // Lets tests simulate a forged assertion signed by a key the SP has never
  // been told to trust, without needing a whole second self-signed cert.
  signingKeyPem = idpKeyPem,
}) {
  if (!email) throw new Error('email is required');

  const responseId = uniqueId();
  const assertionId = uniqueId();
  const issueInstant = isoOffset(0);
  const notBefore = isoOffset(-60_000);
  const notOnOrAfter = isoOffset(5 * 60_000);

  const assertionXml =
    '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ' +
    `ID="${assertionId}" IssueInstant="${issueInstant}" Version="2.0">` +
    `<saml:Issuer>${xmlEscape(issuer)}</saml:Issuer>` +
    '<saml:Subject>' +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${xmlEscape(nameId)}</saml:NameID>` +
    '<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">' +
    `<saml:SubjectConfirmationData Recipient="${xmlEscape(acsUrl)}" NotOnOrAfter="${notOnOrAfter}"/>` +
    '</saml:SubjectConfirmation>' +
    '</saml:Subject>' +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${xmlEscape(audience)}</saml:Audience></saml:AudienceRestriction>` +
    '</saml:Conditions>' +
    `<saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="${assertionId}">` +
    '<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>' +
    '</saml:AuthnStatement>' +
    '<saml:AttributeStatement>' +
    `<saml:Attribute Name="email"><saml:AttributeValue>${xmlEscape(email)}</saml:AttributeValue></saml:Attribute>` +
    '</saml:AttributeStatement>' +
    '</saml:Assertion>';

  const assertionInResponse = signed ? signAssertion(assertionXml, assertionId, signingKeyPem) : assertionXml;

  const responseXml =
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ' +
    `ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${xmlEscape(acsUrl)}">` +
    `<saml:Issuer>${xmlEscape(issuer)}</saml:Issuer>` +
    '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
    assertionInResponse +
    '</samlp:Response>';

  return Buffer.from(responseXml, 'utf8').toString('base64');
}

function idpMetadataXml() {
  const certBody = idpCertPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return (
    '<?xml version="1.0"?>' +
    `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlEscape(idpEntityId)}">` +
    '<IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">' +
    '<KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    `<ds:X509Data><ds:X509Certificate>${certBody}</ds:X509Certificate></ds:X509Data>` +
    '</ds:KeyInfo></KeyDescriptor>' +
    `<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${xmlEscape(idpEntityId)}"/>` +
    '</IDPSSODescriptor>' +
    '</EntityDescriptor>'
  );
}

function loginFormHtml({ acsUrl, spEntityId: audience, relayState }) {
  return `<!doctype html>
<html><body style="font-family: sans-serif; max-width: 420px; margin: 4rem auto;">
  <h2>Test IdP sign-in</h2>
  <p>Simulating a SAML login for <code>${xmlEscape(audience)}</code>.</p>
  <form method="post" action="/sso">
    <input type="hidden" name="acsUrl" value="${xmlEscape(acsUrl)}" />
    <input type="hidden" name="spEntityId" value="${xmlEscape(audience)}" />
    <input type="hidden" name="relayState" value="${xmlEscape(relayState ?? '')}" />
    <label>Email to assert<br/>
      <input type="email" name="email" required autofocus style="width: 100%; padding: 0.5rem; margin: 0.5rem 0;" />
    </label>
    <button type="submit" style="padding: 0.5rem 1rem;">Sign in</button>
  </form>
</body></html>`;
}

function autoPostFormHtml({ acsUrl, samlResponse, relayState }) {
  return `<!doctype html>
<html><body onload="document.forms[0].submit()">
  <p>Redirecting back to the application&hellip;</p>
  <form method="post" action="${xmlEscape(acsUrl)}">
    <input type="hidden" name="SAMLResponse" value="${xmlEscape(samlResponse)}" />
    ${relayState ? `<input type="hidden" name="RelayState" value="${xmlEscape(relayState)}" />` : ''}
    <noscript><button type="submit">Continue</button></noscript>
  </form>
</body></html>`;
}

// A tiny Express app playing the IdP's part of the browser redirect: shows a
// login form, then POSTs a signed assertion straight to the SP's ACS URL via
// an auto-submitting form (the standard SAML POST binding relay pattern).
export function createIdpSimulatorApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/metadata', (req, res) => {
    res.type('application/xml').send(idpMetadataXml());
  });

  app.get('/cert', (req, res) => {
    res.type('text/plain').send(idpCertPem);
  });

  app.get('/sso', (req, res) => {
    const acsUrl = req.query.acsUrl || spCallbackUrl;
    const audience = req.query.spEntityId || spEntityId;
    res.type('html').send(loginFormHtml({ acsUrl, spEntityId: audience, relayState: req.query.RelayState }));
  });

  app.post('/sso', (req, res) => {
    const { email, acsUrl, spEntityId: audience, relayState } = req.body ?? {};
    if (!email) return res.status(400).send('email is required');
    const samlResponse = buildSignedSamlResponse({
      email,
      acsUrl: acsUrl || spCallbackUrl,
      spEntityId: audience || spEntityId,
    });
    res.type('html').send(autoPostFormHtml({ acsUrl: acsUrl || spCallbackUrl, samlResponse, relayState }));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 7000);
  createIdpSimulatorApp().listen(port, () => {
    console.log(`SAML IdP simulator listening on http://localhost:${port}`);
    console.log('');
    console.log('Configure the admin "Single sign-on" tab with:');
    console.log(`  IdP entity ID:   ${idpEntityId}`);
    console.log(`  IdP SSO URL:     http://localhost:${port}/sso`);
    console.log(`  IdP certificate: http://localhost:${port}/cert (paste the full contents)`);
  });
}
