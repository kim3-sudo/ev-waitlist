import { Router } from 'express';
import { updateSettings } from '../services/settingsService.js';

export const adminSetupRouter = Router();

// Ends the first-run setup wizard. Called after the wizard's final step, or
// when the admin chooses to skip the remaining steps.
adminSetupRouter.post('/complete', async (req, res) => {
  const settings = await updateSettings({ setupCompleted: true });
  res.json(settings);
});
