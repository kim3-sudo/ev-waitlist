import { Router } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { buildSamlClient, getSamlConfig } from '../services/samlService.js';

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

  const email = profile?.email || profile?.mail || profile?.nameID;
  if (!email) return res.status(401).send('SAML assertion did not include an email address');

  let admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    if (!samlConfig.autoProvision) {
      return res.status(401).send(`No account found for ${email} and auto-provisioning is disabled`);
    }
    admin = await prisma.admin.create({ data: { email, passwordHash: null } });
  }

  const token = jwt.sign({ sub: admin.id, email: admin.email }, config.jwtSecret, { expiresIn: '12h' });
  const redirectUrl = new URL('/sso/callback', config.corsOrigin);
  redirectUrl.searchParams.set('token', token);
  redirectUrl.searchParams.set('email', admin.email);
  res.redirect(redirectUrl.toString());
});
