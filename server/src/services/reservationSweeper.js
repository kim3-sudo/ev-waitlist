import { rawPrisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from './runtimeConfig.js';
import { sweepExpiredReservations } from './dispatcher.js';

const SWEEP_INTERVAL_MS = 20_000;

// Runs the expiry sweep once for every site. The sweeper has no request, so it
// has to set each site in turn.
export async function sweepAllTenants() {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    // One site failing must not stop the others from being swept.
    await ensureSiteLoaded(tenant.id);
    await runWithTenant(tenant.id, () => sweepExpiredReservations()).catch((err) =>
      console.error(`Reservation sweep failed for site ${tenant.id}:`, err),
    );
  }
}

export function startReservationSweeper() {
  return setInterval(() => {
    sweepAllTenants().catch((err) => console.error('Reservation sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
}
