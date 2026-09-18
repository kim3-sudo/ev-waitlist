import { Router } from 'express';
import { getSettings } from '../services/settingsService.js';

export const settingsRouter = Router();

// Public: branding + which identifier(s) the join form should collect.
// Read by both the public waitlist page and the admin settings form.
settingsRouter.get('/', async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});
