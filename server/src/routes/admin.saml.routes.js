import { Router } from 'express';
import { getSamlConfig, updateSamlConfig, spEntityId, spCallbackUrl } from '../services/samlService.js';

export const adminSamlRouter = Router();

adminSamlRouter.get('/', async (req, res) => {
  const samlConfig = await getSamlConfig();
  res.json({
    ...samlConfig,
    sp: { entityId: spEntityId, acsUrl: spCallbackUrl, metadataUrl: spEntityId },
  });
});

adminSamlRouter.put('/', async (req, res) => {
  const { enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision } = req.body ?? {};

  try {
    const samlConfig = await updateSamlConfig({ enabled, idpEntityId, idpSsoUrl, idpCertificate, autoProvision });
    res.json(samlConfig);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
