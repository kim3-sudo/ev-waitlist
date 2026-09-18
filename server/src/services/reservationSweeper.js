import { sweepExpiredReservations } from './dispatcher.js';

const SWEEP_INTERVAL_MS = 20_000;

export function startReservationSweeper() {
  return setInterval(() => {
    sweepExpiredReservations().catch((err) => console.error('Reservation sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
}
