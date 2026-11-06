import { Router } from 'express';
import { settingsView, updateSettings } from '../services/settingsService.js';

export const adminSettingsRouter = Router();

adminSettingsRouter.put('/', async (req, res) => {
  const {
    companyName,
    logoUrl,
    primaryColor,
    secondaryColor,
    fontFamily,
    identifierMode,
    mfaRequired,
    plateRegionConfig,
    defaultPlateRegion,
  } = req.body ?? {};

  try {
    const settings = await updateSettings({
      companyName,
      logoUrl,
      primaryColor,
      secondaryColor,
      fontFamily,
      identifierMode,
      mfaRequired,
      plateRegionConfig,
      defaultPlateRegion,
    });
    res.json(settingsView(settings));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
