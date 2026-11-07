import { readPageRequest } from '../pagination.js';
import { Router } from 'express';
import { listAlerts, createAlert, updateAlert, deleteAlert, chargePointTargets } from '../services/notices.js';

// Mounted behind alerts.manage.
export const adminAlertsRouter = Router();

adminAlertsRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  res.json(await listAlerts({ instanceAdmin: req.admin.instanceAdmin, ...page }));
});

// The charge points, zones and locations an alert can be about.
adminAlertsRouter.get('/targets', async (req, res) => {
  res.json(await chargePointTargets());
});

adminAlertsRouter.post('/', async (req, res) => {
  const result = await createAlert(req.body ?? {}, { adminId: req.admin.sub, instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.status(201).json(result.alert);
});

adminAlertsRouter.put('/:id', async (req, res) => {
  const result = await updateAlert(req.params.id, req.body ?? {}, { instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.json(result.alert);
});

adminAlertsRouter.delete('/:id', async (req, res) => {
  const result = await deleteAlert(req.params.id, { instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.status(204).end();
});
