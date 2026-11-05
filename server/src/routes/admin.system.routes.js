import { Router } from 'express';
import { saveRuntimeSettings, runtimeSettingsView } from '../services/runtimeConfig.js';

// Mounted behind system.manage. Covers the "system" settings group only.
export const adminSystemRouter = Router();
const GROUPS = ['system'];

adminSystemRouter.get('/', (req, res) => {
  res.json(runtimeSettingsView(GROUPS));
});

adminSystemRouter.put('/', async (req, res) => {
  const result = await saveRuntimeSettings(req.body ?? {}, GROUPS);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(runtimeSettingsView(GROUPS));
});
