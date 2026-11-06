import { Router } from 'express';
import { getSettings, settingsView } from '../services/settingsService.js';
import { currentRoaming } from '../services/roaming.js';
import { smsAvailable } from '../services/notifier.js';

export const settingsRouter = Router();

// Public: branding + which identifier(s) the join form should collect, and the plate
// regions it offers. Read by both the public waitlist page and the admin settings form.
settingsRouter.get('/', async (req, res) => {
  const settings = await getSettings();
  // Whether the join form may offer text messages.
  res.json({ ...settingsView(settings), smsAvailable: smsAvailable() });
});

// Public: whether roaming drivers may join this site's waitlist, and the warning they must read first.
settingsRouter.get('/roaming', async (req, res) => {
  res.json(await currentRoaming());
});
