import { Router } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { buildSamlClient, getSamlConfig, resolveSsoLogin } from '../services/samlService.js';

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
    return res.status(401).send(`SAML login failed: ${err.message}`);
  }

  const result = await resolveSsoLogin(profile, samlConfig);
  if (result.status) return res.status(result.status).send(result.message);
  const { admin } = result;

  const token = jwt.sign({ sub: admin.id, email: admin.email, tenantId: admin.tenantId }, config.jwtSecret, { expiresIn: '12h' });
  const redirectUrl = new URL('/sso/callback', siteConfig().corsOrigin);
  redirectUrl.searchParams.set('token', token);
  redirectUrl.searchParams.set('email', admin.email);
  res.redirect(redirectUrl.toString());
});
