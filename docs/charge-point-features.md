# Charge point features

Turn features on per charge point. Each feature sends its messages only when its switch is on, so hardware never receives a message it can't handle.

## Turn on features

Set these when you add a charge point, or later in its settings. All three are **off by default**, including for existing charge points.

| Switch | Enables |
|---|---|
| Smart charging | Power limits (`SetChargingProfile`, `ClearChargingProfile`) |
| Firmware updates and diagnostics logs | Firmware installs (`UpdateFirmware`) and log requests (`GetDiagnostics`, or `GetLog` on OCPP 2.0.1) |
| Local authorization list | The site's ID tag list (`SendLocalList`), so the charge point decides offline |

After you upgrade, turn on the switches your charge points support.

## Manage firmware and logs

Files are stored on the server's disk under `<data directory>/files/`. The database stores each file's name, size, and SHA-256 checksum.

1. Go to **Charge point features > Firmware and diagnostics**.
2. Upload firmware (up to 200 MB), and add its name, version, vendor, model, and notes.
3. To install firmware, open the charge point, choose an image, and select **Install**. The charge point gets a signed link valid for three days, for that image only.
4. To get a diagnostics log, open the charge point and select **Request diagnostics log**. The charge point gets a one-time upload address valid for 48 hours. Logs appear on the same page, where you can download or delete them (100 MB limit).

Before you start, do these:

- Set the public address (`PUBLIC_URL`). Charge points need it to reach files.
- Upload firmware only from the vendor. The server doesn't sign firmware, so have the charge point verify the image if it can.
- Know that deleting a firmware image stops any charge point that hasn't downloaded it yet.

## Use smart charging

Set a fixed amp limit for a whole charge point or one connector, and remove it when you no longer need it. A connector limit works as a **ceiling**. Load balancing and schedules never send a higher limit. Schedules and events can lower a limit, but never raise it.

If a schedule holds a connector below its manual limit, the server shows a warning in the status dialog, on the Load balancing page, and in the charge point's history. You can still set a manual limit above a schedule's ceiling.

### Create time-of-day schedules

A schedule caps connectors during a time window, such as 16 A from 17:00 to 21:00 on weekdays. Add schedules with `PUT /api/admin/load-balancing/config` under `schedules`.

- Give each schedule a name, days (0 is Sunday, 6 is Saturday), start and end times (`HH:MM`), a limit from 6 to 80 A, and optionally a list of charge points. An empty list covers all of them.
- The end time is excluded. An overnight window (start later than end) belongs to the day it starts.
- Set `timeZone` to an IANA name such as `Europe/London`. The default is UTC.
- When windows overlap, the lowest limit wins.
- Schedules cap idle connectors too, so the next car starts at the limit. They work even when load balancing is off.

### Add dynamic events (curtailment)

Use an event to cut supply for a period, such as when a utility asks you to reduce demand from 16:00 to 18:00. Add events to the `events` list in the same configuration. Each event needs a name, start and end times, and an amp capacity per phase. Set phase capacity first.

The supply on each phase is the lower of its base capacity and any active event. When an event ends, the base capacity returns.

## Balance load

If your supply can't power every charge point at full power at once, load balancing shares it. Choose one of two modes.

**Per phase (recommended).**

1. Set the supply in amps for each phase (`phaseCapacityA`: L1, L2, and L3) in the configuration.
2. On each connector's details, set `phaseCount` (1 or 3). For a single-phase connector, also set `phase` (L1, L2, or L3).

A three-phase connector draws from all three phases. A single-phase connector draws from its own phase. A connector with no wiring set counts on every phase, which is the safe choice. The server shares the supply fairly and rounds each limit down to whole amps. It reports the phases that limit supply in `saturatedPhases`.

**Total kW (original mode).**

1. Enter the total supply in kW under **Charge point features > Load balancing**.
2. Leave phase capacity empty.

The server splits the supply equally across charging connectors. It assumes 230 V single-phase, unless you set a connector's voltage. This mode doesn't support events.

**In both modes:**

- Each connector gets at least 6 A. If the supply can't meet that minimum, the server reports it as over capacity.
- An idle connector stays at its maximum, so the next car starts at full power.
- The server recalculates when a session starts or stops, when you change settings, and every minute. The minute check applies schedules and events at their start and end times.
- A manual limit acts as a ceiling. The server uses the lower of the two.
- To return to each charge point's own limits, turn off load balancing or remove the manual limit.
- Offline charge points get their limits when they reconnect.

Set supply and schedules under **Load balancing**. Set phase wiring on each charge point's connector section.

## Manage the local authorization list

Under **Charge point features > Local authorization list**, add ID tags as:

- **Accepted:** can charge on a charge point that keeps the list, even offline.
- **Blocked:** refused everywhere. The server also refuses blocked tags.

The server sends the full list (up to 500 entries) to each connected charge point with the switch on, after every change. An offline charge point keeps its old list until it reconnects.

## Use OCPP 2.0.1

Charge points can connect with OCPP 1.6J or 2.0.1. The server negotiates the version, and sessions are billed the same way on both.

**Supported on 2.0.1:**

- Connection: `BootNotification`, `Heartbeat`, `StatusNotification`, `DataTransfer`
- Authorization: `Authorize`. Blocked tags are refused.
- Sessions: `TransactionEvent` (Started, Updated, Ended), with meter values and billing. A session that starts with an unauthorized tag is stopped with `RequestStopTransaction`.
- Meter values: `MeterValues`
- Firmware and logs: `FirmwareStatusNotification`, `LogStatusNotification`
- Server commands: stop a session, unlock a connector, reset, trigger a message, change availability, clear cache, update firmware, request diagnostics, set charging limits, and manage the local list

**Not supported on 2.0.1:**

- Configuration (use `GetVariables` and `SetVariables` instead of `GetConfiguration` and `ChangeConfiguration`)
- Reservations
- Device model reporting and certificate-based security profiles
- `RequestStartTransaction`
- Charge points with more than one EVSE. Connector numbers map to EVSE 1.

The server refuses commands with no 2.0.1 equivalent and sends nothing. The server checks 2.0.1 messages against the official JSON schema.

## Set up tax

Go to **Billing > Tax rules** and add a rule:

- **Rate:** a percentage, such as `20` for 20%.
- **Mode:** *exclusive* adds tax on top of the price, or *inclusive* keeps tax inside the price.
- **Applies to:** every session, per-kWh sessions, or per-minute sessions.
- **Scope:** the whole site, one zone, or one charge point.
- **Validity window** (optional) and **priority** (lower numbers apply first).

The server removes inclusive taxes from the price first, then adds exclusive taxes to the net amount. Exclusive taxes don't compound. It rounds each tax half-up to the cent.

Select **Check a price** on the Tax rules tab to preview tax before you charge anyone. The server calculates tax when a session ends and stores it on the charge, so later rule changes don't affect past charges. Rules that name a deleted zone or charge point are ignored.

Before you take payment, have your accountant confirm your rules and document requirements. The software applies the rules you enter. It doesn't know your jurisdiction's requirements.

## Issue receipts and invoices

- **Consumer receipts** issue automatically when a charge is paid, numbered like `RCP-2026-00001`.
- **B2B invoices** cover paid charges you select, numbered like `INV-2026-00001`. Each charge goes on one invoice only. Due dates come from the payment terms.
- **Credit notes** reverse an invoice with negative lines. Each invoice can be credited once.
- Print any document from the browser, and choose **Save as PDF**.

Email and tax options:

- To email receipts or invoices, set up email for the site, then turn on the switch in **Business details**. The email links to the receipt at `/api/receipts/<charge token>`. Invoice emails contain a text summary, not the printed page.
- For tax-exempt B2B customers, invoices carry no tax and print the exemption reference. The software doesn't support reverse charge or per-customer tax rules. Consumer receipts always include tax.
- Price displays to drivers don't yet show whether tax is included.
- Card holds are placed before tax is known, so a hold can be smaller than the final total. The payment link collects the difference.

## Create charging plans

Under **Charging plans**, define a plan with a name, a monthly fee in cents, and a discount percentage. Enroll drivers by their ID tag.

- Subscribers get their discount before tax. The charge records it.
- Each ID tag can have one active plan. To retire a plan with subscribers, close it to new enrolments. You can't delete it.
- Choose a billing customer when you enroll a subscriber. Select **Bill this month's plan fees** to put fees on one invoice per customer. Each subscription bills once per calendar month.
- Subscribers without a billing customer get the discount, but you must collect their fee yourself. The software doesn't collect consumer subscription fees yet.

## Reverse a charge

On the Receipts tab, select **Reverse** and enter a reason. The receipt shows the reversal and reason, and the charge leaves the invoiceable list.

Reversal records the change only. It doesn't move money. Refund the payment at your payment provider. If the charge is on an invoice, issue a credit note as well. The reply tells you which.

## Set up webhooks

Under **Webhooks**, add an `https` endpoint and choose its events, or select all. The secret appears once, when you create the endpoint. Store it in your receiving system.

Events: charge paid, charge reversed, session started, session stopped, station faulted, invoice issued, subscription started, subscription cancelled.

Each post is JSON with headers `X-Plugyard-Event`, `X-Plugyard-Delivery`, and `X-Plugyard-Signature`. The signature has the form `t=<unix seconds>,v1=<HMAC-SHA256 of "<t>.<body>">`, keyed with the endpoint secret. Verify the signature, and reject timestamps older than five minutes.

Failed posts retry after 1, 2, 4 minutes, and so on, up to six hours, then stop after ten attempts. Use the delivery log to see results and retry an event. The server blocks addresses on private networks unless you set `WEBHOOK_ALLOW_PRIVATE_NETWORKS=1`.
