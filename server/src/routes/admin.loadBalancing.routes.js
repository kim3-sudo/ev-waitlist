import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { prisma } from '../db.js';
import { rebalanceLater, rebalanceSite } from '../services/loadBalance.js';

// Load balancing settings: whether the site shares its supply, and how much it has. Mounted behind
// stations.view (reads) and stations.manage (changes).
export const adminLoadBalancingRouter = Router();

async function view() {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } });
  const smart = await prisma.station.count({ where: { smartChargingEnabled: true } });
  return {
    enabled: Boolean(tenant.loadBalancingEnabled),
    siteCapacityKw: tenant.siteCapacityKw ?? null,
    chargePointsWithSmartCharging: smart,
    note: 'Charge points with smart charging on share the site supply while they charge. A manual limit set on the charge point page is overridden while load balancing is on.',
  };
}

adminLoadBalancingRouter.get('/', async (_req, res) => {
  res.json(await view());
});

adminLoadBalancingRouter.put('/', async (req, res) => {
  const body = req.body ?? {};
  const data = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    data.loadBalancingEnabled = body.enabled;
  }
  if (body.siteCapacityKw !== undefined) {
    if (body.siteCapacityKw === null || body.siteCapacityKw === '') {
      data.siteCapacityKw = null;
    } else {
      const kw = Number(body.siteCapacityKw);
      if (!Number.isFinite(kw) || kw <= 0 || kw > 100000) return res.status(400).json({ error: 'The site supply must be a number of kW above zero' });
      data.siteCapacityKw = kw;
    }
  }
  if (data.loadBalancingEnabled && !(data.siteCapacityKw ?? (await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } })).siteCapacityKw > 0)) {
    return res.status(400).json({ error: 'Enter the site supply in kW before turning load balancing on' });
  }
  await rawPrisma.tenant.update({ where: { id: currentTenantId() }, data });
  rebalanceLater(currentTenantId());
  res.json(await view());
});

// Runs the balance now, and says what it did.
adminLoadBalancingRouter.post('/run', async (_req, res) => {
  const out = await rebalanceSite(currentTenantId());
  res.json(out);
});
