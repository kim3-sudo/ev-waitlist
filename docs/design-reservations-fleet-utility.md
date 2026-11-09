# Design: reservations, fleets, and utility programs

**Status: design only.** Smart charging depth (schedules, events, phase-aware balancing) is built. See [charge point features](charge-point-features.md#use-smart-charging). Everything below is not built.

## 1. Advance bookings

**Today:** Waitlist holds reserve a connector for the next driver, using OCPP 1.6 `ReserveNow` when supported, or a soft hold enforced by Plugyard otherwise. Admins can hold a connector for one ID tag. Holds expire, and a sweeper clears them every 20 seconds.

**Gap:** Drivers can't book a future window, and nothing enforces one.

**Plan:** Add a `Booking` table with:

- `stationId`, `connectorId`, or `zoneId`
- `idTag` or `driverAccountId`
- `startsAt` and `endsAt` (UTC)
- `status`: `PENDING_PAYMENT`, `CONFIRMED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, or `NO_SHOW`
- `paymentHoldId` (optional, reuses `PaymentHold`)
- `ocppReservationId` (set when `ReserveNow` succeeds)

The server enforces each booking:

1. **Reserve.** About 10 minutes before `startsAt`, send `ReserveNow` (OCPP 1.6) with `expiryDate = endsAt + grace`. If a walk-in is charging, wait for it to finish and tell the driver.
2. **Gate authorization.** During a booked window, refuse any tag except the booked one on that connector. This works without `ReserveNow`. It can't stop a driver who skips authorization, such as one using a local list. Keep booked tags off local lists, or time-limit them.
3. **Fall back.** If the charge point refuses `ReserveNow` or can't be reached, keep a soft hold that blocks walk-ins during the window.
4. **Release.** Send `CancelReservation` when a booking is cancelled or expires. The sweeper marks unused bookings `NO_SHOW` after the grace period.

**Limit:** A reservation is a server-side promise, not a hardware lock. Tell drivers this. Connectors with no reservation support and no authorization check can't be booked.

**Money:** Route booking, cancellation, and no-show fees through `payments/holds.js`. Have counsel review them, as with existing holds.

**UI and API:** Drivers book from the locator panel. Admins see a timeline per connector. Add `bookings` endpoints behind a `bookings.manage` permission.

**Work:** Add the table, a booking service, a 1-minute tick (like the smart charging ticker), the `Authorize` gate, the `ReserveNow` and `CancelReservation` calls, and tests against the fake charge point.

## 2. Driver groups and fleets

**Today:** Driver accounts, ID tags, price rules scoped to site, zone, or charge point, and charging plans all exist.

**Driver groups.** A group is a named set of ID tags or driver accounts that share:

- **Price rules.** The most specific matching rule wins: group rules beat site rules, and priority breaks ties.
- **Access.** Which stations and zones the group may use, checked by `Authorize` and the local list.
- **Charging windows.** Schedules can target a group. Change the schedule's `stationIds` to a general `scope` of stations, zones, and groups.
- **Free charging.** A group flag, replacing per-session complimentary charges.

Each ID tag belongs to one group at a time. Vehicles inherit their account's group. Fleets need CSV import.

**Fleets.** A fleet owns several ID tags or vehicles and receives one invoice.

- Set a monthly energy budget (kWh) and a spending cap per vehicle or group. The server refuses sessions that exceed the cap.
- Bill one `BillingCustomer` for all members. Each driver or vehicle gets its own invoice line.
- Add a fleet manager role (`fleet.manage`) to manage members, budgets, and reports for one fleet only.
- Report by group and fleet with the existing usage report.

**Work:** Add the group and membership tables, change the rule scope in `priceRules.js`, add the `Authorize` check, add fleet budgets, and add the fleet manager role. Test each step against the current pricing and billing tests.

## 3. Utility programs (demand response)

**Today:** Dynamic events cap per-phase capacity with the lowest value winning (`smartCharging.js`). Load balancing shares that capacity fairly. The REST API and webhooks are available.

**Event intake:**

1. **API first.** A utility or fleet operator calls `POST /api/v1/dr-events` with a service account, giving a start, an end, and a target in kW or amps. The server converts kW to amps per phase (`I = P / (√3 · V)` for a balanced three-phase supply) and creates an event.
2. **OpenADR 2.0b** (US utilities). A virtual end node polls the utility's VTN for `EVENT` signals and maps them to the same model. This requires certification.

**Targets and opt-outs.** Define a program with sites, a target (for example, a 30% reduction from baseline), and an opt-out. Exclude groups from curtailment with the group model.

**Measurement:**

- **Baseline:** metered energy per charge point for the same hours on recent similar days, using the "high X of Y days" method. Use the stored `MeterSample` values.
- **Performance:** actual energy during the event, compared with the baseline. Store it per event and show it in admin pages and a utility report.
- **Payment:** if the program pays per kW, use the performance figure. Review the rules against the utility contract before you send anything.

**Priority:** An active utility event overrides everything. Schedules and balancing run within its limit. The existing `min()` rule already does this.

**Price signals:** Later, use utility time-of-use prices to drive schedules. Schedules already accept any window.

**Work:** Add the kW-to-amps conversion with tests, the public event endpoint, program and event tables, the baseline calculation from `MeterSample`, and the performance report. OpenADR is a separate project.

## Order of work

1. Smart charging depth: done.
2. Utility event endpoint, with baseline and performance reporting.
3. Driver groups, then fleet budgets and billing.
4. Advance bookings. These need the group model and a legal review of booking fees.
5. OpenADR, if a utility requires it.
