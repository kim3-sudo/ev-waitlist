import { Router } from 'express';
import {
  getSamlConfig,
  updateSamlConfig,
  validateSamlInput,
  parseGroupRoleMappings,
  spEntityId,
  spCallbackUrl,
  currentSiteSlug,
} from '../services/samlService.js';

export const adminSamlRouter = Router();

adminSamlRouter.get('/', async (req, res) => {
  const samlConfig = await getSamlConfig();
  const slug = await currentSiteSlug();
  res.json({
    ...samlConfig,
    groupRoleMappings: parseGroupRoleMappings(samlConfig.groupRoleMappings),
    sp: { entityId: spEntityId(slug), acsUrl: spCallbackUrl(slug), metadataUrl: spEntityId(slug) },
  });
});

adminSamlRouter.put('/', async (req, res) => {
  const { value, error } = await validateSamlInput(req.body ?? {});
  if (error) return res.status(400).json({ error });

  try {
    const samlConfig = await updateSamlConfig(value);
    res.json({ ...samlConfig, groupRoleMappings: parseGroupRoleMappings(samlConfig.groupRoleMappings) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
