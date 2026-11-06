import { Router } from 'express';
import { getSettings } from '../services/settingsService.js';
import { currentRoaming } from '../services/roaming.js';

export const settingsRouter = Router();

// Public: branding + which identifier(s) the join form should collect.
// Read by both the public waitlist page and the admin settings form.
settingsRouter.get('/', async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

// Public: whether roaming drivers may join this site's waitlist, and the warning they must read first.
settingsRouter.get('/roaming', async (req, res) => {
  res.json(await currentRoaming());
});
