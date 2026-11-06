import { Router } from 'express';
import { TEMPLATE_DEFS, listTemplates, resetTemplate, saveTemplate } from '../services/messageTemplates.js';

// Message wording for drivers. Mounted behind branding.manage.
export const adminTemplatesRouter = Router();

adminTemplatesRouter.get('/', async (req, res) => {
  res.json(await listTemplates());
});

adminTemplatesRouter.put('/:key', async (req, res) => {
  if (!TEMPLATE_DEFS[req.params.key]) return res.status(404).json({ error: 'Unknown message' });
  const { subject, body, sms } = req.body ?? {};
  const result = await saveTemplate(req.params.key, { subject, body, sms });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json((await listTemplates()).find((t) => t.key === req.params.key));
});

// Drops the site's own wording, so the built-in text is used again.
adminTemplatesRouter.delete('/:key', async (req, res) => {
  const result = await resetTemplate(req.params.key);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json((await listTemplates()).find((t) => t.key === req.params.key));
});
