// OCPP 1.6 reservationId is transmitted as a plain (small) integer. A
// process-local, wrapping counter is sufficient since only one reservation
// per connector is ever active at a time.
let counter = 0;

export function nextReservationId() {
  counter = (counter % 65535) + 1;
  return counter;
}
