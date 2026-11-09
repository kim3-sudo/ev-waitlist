import { Router } from 'express';
import { buildDashboard } from '../services/dashboard.js';

// The admin home page dashboard. Mounted under /api/admin/dashboard behind stations.view.
// Money is included only for admins who can also see payments (payments.view).
export const adminDashboardRouter = Router();

const ALLOWED_DAYS = [1, 7, 30];

adminDashboardRouter.get('/', async (req, res) => {
  const days = ALLOWED_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  res.json(await buildDashboard({ days, permissions: req.admin.permissions }));
});
