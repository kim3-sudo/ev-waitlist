import { readPageRequest } from '../pagination.js';
import { Router } from 'express';
import { chargePointTargets } from '../services/notices.js';
import {
  listPriceRules,
  createPriceRule,
  updatePriceRule,
  deletePriceRule,
} from '../services/payments/priceRuleService.js';

// Mounted behind payments.view (reads) and payments.manage (writes).
export const adminPriceRulesRouter = Router();

adminPriceRulesRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  res.json(await listPriceRules({ instanceAdmin: req.admin.instanceAdmin, ...page }));
});

adminPriceRulesRouter.get('/targets', async (req, res) => {
  res.json(await chargePointTargets());
});

adminPriceRulesRouter.post('/', async (req, res) => {
  const result = await createPriceRule(req.body ?? {}, { adminId: req.admin.sub, instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.status(201).json(result.rule);
});

adminPriceRulesRouter.put('/:id', async (req, res) => {
  const result = await updatePriceRule(req.params.id, req.body ?? {}, { instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.json(result.rule);
});

adminPriceRulesRouter.delete('/:id', async (req, res) => {
  const result = await deletePriceRule(req.params.id, { instanceAdmin: req.admin.instanceAdmin });
  if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
  res.status(204).end();
});
