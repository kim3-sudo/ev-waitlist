import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { prisma } from '../db.js';
import { ceilingWarnings, rebalanceLater, rebalanceSite } from '../services/loadBalance.js';
import { normalizeConfig, parseStoredConfig, SmartChargingConfigError } from '../services/smartCharging.js';

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
    smartCharging: parseStoredConfig(tenant.smartChargingConfig),
    // Manual limits that a schedule is holding down right now.
    ceilingWarnings: await ceilingWarnings(currentTenantId()),
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
  if (data.loadBalancingEnabled) {
    const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } });
    const hasKw = (data.siteCapacityKw ?? tenant.siteCapacityKw) > 0;
    const hasPhases = parseStoredConfig(tenant.smartChargingConfig).phaseCapacityA != null;
    if (!hasKw && !hasPhases) {
      return res.status(400).json({ error: 'Enter the site supply in kW, or set the supply per phase, before turning load balancing on' });
    }
  }
  await rawPrisma.tenant.update({ where: { id: currentTenantId() }, data });
  rebalanceLater(currentTenantId());
  res.json(await view());
});

// Smart charging depth: the time zone, phase capacity, time-of-day schedules and dynamic events.
// The whole configuration is replaced by each save, after it has been checked.
adminLoadBalancingRouter.put('/config', async (req, res) => {
  let config;
  try {
    config = normalizeConfig(req.body ?? {});
  } catch (err) {
    if (err instanceof SmartChargingConfigError) return res.status(400).json({ error: err.message });
    throw err;
  }
  await rawPrisma.tenant.update({ where: { id: currentTenantId() }, data: { smartChargingConfig: JSON.stringify(config) } });
  rebalanceLater(currentTenantId());
  res.json(await view());
});

// Runs the balance now, and says what it did.
adminLoadBalancingRouter.post('/run', async (_req, res) => {
  const out = await rebalanceSite(currentTenantId());
  res.json(out);
});
