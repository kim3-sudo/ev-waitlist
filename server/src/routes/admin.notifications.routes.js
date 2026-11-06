import { Router } from 'express';
import { saveRuntimeSettings, runtimeSettingsView, siteConfig, EMAIL_PROVIDERS, SMS_PROVIDERS } from '../services/runtimeConfig.js';
import { emailProblem, deliverEmail } from '../services/channels/email.js';
import { smsProblem, deliverSms } from '../services/channels/sms.js';
import { looksLikeEmail, normalizePhone } from '../services/contact.js';

// Mounted behind integrations.manage. E-mail and text message providers, and a test send for each.
export const adminEmailRouter = Router();
export const adminSmsRouter = Router();

function emailView() {
  return { ...runtimeSettingsView(['email']), providers: EMAIL_PROVIDERS, problem: emailProblem(siteConfig().email) };
}

function smsView() {
  return { ...runtimeSettingsView(['sms']), providers: SMS_PROVIDERS, problem: smsProblem(siteConfig().sms) };
}

adminEmailRouter.get('/', (req, res) => res.json(emailView()));

adminEmailRouter.put('/', async (req, res) => {
  const result = await saveRuntimeSettings(req.body ?? {}, ['email']);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(emailView());
});

adminEmailRouter.post('/test', async (req, res) => {
  const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!looksLikeEmail(to)) return res.status(400).json({ ok: false, error: 'Enter the e-mail address to send the test to.' });
  const cfg = siteConfig().email;
  const problem = emailProblem(cfg);
  if (problem) return res.status(400).json({ ok: false, error: problem });
  try {
    await deliverEmail(cfg, {
      to,
      subject: 'Test message from your waitlist',
      text: 'This is a test message. If you received it, e-mail for this site is working.',
    });
    res.json({ ok: true, message: `Test message sent to ${to}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: `The test message was not sent. ${err.message}` });
  }
});

adminSmsRouter.get('/', (req, res) => res.json(smsView()));

adminSmsRouter.put('/', async (req, res) => {
  const result = await saveRuntimeSettings(req.body ?? {}, ['sms']);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(smsView());
});

adminSmsRouter.post('/test', async (req, res) => {
  const to = normalizePhone(req.body?.to);
  if (!to) {
    return res.status(400).json({ ok: false, error: 'Enter a mobile number with its country code, for example +1 555 123 4567.' });
  }
  const cfg = siteConfig().sms;
  const problem = smsProblem(cfg);
  if (problem) return res.status(400).json({ ok: false, error: problem });
  try {
    await deliverSms(cfg, { to, body: 'Test message from your waitlist. If you received it, text messages for this site are working.' });
    res.json({ ok: true, message: `Test text message sent to ${to}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: `The test text message was not sent. ${err.message}` });
  }
});
