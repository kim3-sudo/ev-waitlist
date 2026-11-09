import { rebalanceAllSites } from './loadBalance.js';

// Re-runs the balance every minute, so a time-of-day schedule or a dynamic event takes effect when
// it starts and ends, not only when a session starts or stops. Sites with nothing to apply are
// skipped in one query, so the cost is small.
const TICK_MS = 60 * 1000;

export function startSmartChargingTicker() {
  const timer = setInterval(() => {
    rebalanceAllSites().catch((err) => console.error('[smart-charging] tick failed:', err.message));
  }, TICK_MS);
  timer.unref?.();
  return timer;
}
