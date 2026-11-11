import { Router } from 'express';
import express from 'express';
import { siteConfig } from '../services/runtimeConfig.js';
import { rawPrisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from '../services/runtimeConfig.js';
import { buildSamlClient, getSamlConfig, resolveSsoLogin } from '../services/samlService.js';
import { consumeSsoCode, issueSsoCode } from './sessionToken.js';
import { sessionBody } from './sessionBody.js';

export const samlRouter = Router();

samlRouter.get('/status', async (req, res) => {
  const samlConfig = await getSamlConfig();
  res.json({ enabled: samlConfig.enabled });
});

samlRouter.get('/metadata', async (req, res) => {
  const samlConfig = await getSamlConfig();
  if (!samlConfig.enabled) return res.status(404).json({ error: 'SAML SSO is not enabled' });

  const saml = await buildSamlClient();
  if (!saml) return res.status(404).json({ error: 'SAML SSO is not configured' });

  res.type('application/xml').send(saml.generateServiceProviderMetadata(null, null));
});

samlRouter.get('/login', async (req, res) => {
  const saml = await buildSamlClient();
  if (!saml) return res.status(404).json({ error: 'SAML SSO is not configured' });

  const url = await saml.getAuthorizeUrlAsync('', undefined, {});
  res.redirect(url);
});

// SAML's POST binding delivers the assertion as a form-encoded body, so this
// route needs its own urlencoded parser rather than the app-wide JSON one.
samlRouter.post('/acs', express.urlencoded({ extended: false }), async (req, res) => {
  const samlConfig = await getSamlConfig();
  const saml = await buildSamlClient();
  if (!saml) return res.status(404).json({ error: 'SAML SSO is not configured' });

  let profile;
  try {
    ({ profile } = await saml.validatePostResponseAsync(req.body));
  } catch (err) {
    // The reason can quote what the sender posted, so it goes to the log, not to the page.
    console.warn('[saml] sign-in refused:', err.message);
    return res.status(401).type('text/plain').send('SAML login failed');
  }

  const result = await resolveSsoLogin(profile, samlConfig);
  if (result.status) return res.status(result.status).type('text/plain').send(result.message);
  const { admin } = result;

  // The browser gets a one-time code, not the session token, so no token ever appears in a web
  // address (history, logs, Referer headers). The page trades the code for a session.
  const code = await issueSsoCode(admin.id);
  const redirectUrl = new URL('/sso/callback', siteConfig().corsOrigin);
  redirectUrl.searchParams.set('code', code);
  res.set('Cache-Control', 'no-store');
  res.redirect(redirectUrl.toString());
});

// Trades the code from the redirect for a session, once, within a minute. Answers like a sign-in.
samlRouter.post('/exchange', async (req, res) => {
  const adminId = await consumeSsoCode(req.body?.code);
  const admin = adminId ? await rawPrisma.admin.findUnique({ where: { id: adminId } }) : null;
  if (!admin) return res.status(401).json({ error: 'This sign-in link has expired. Sign in again.' });
  await ensureSiteLoaded(admin.tenantId);
  // Permissions are read from the account's own site.
  const body = await runWithTenant(admin.tenantId, () => sessionBody(admin));
  res.set('Cache-Control', 'no-store');
  res.json(body);
});
