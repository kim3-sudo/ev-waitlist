# Charge point features, firmware, OCPP 2.0.1, tax and billing

This covers what was added for white-label deployments, where the charge points a site uses are not known in advance.

## Turn features on per charge point

Each charge point has three switches, set when it is added and in its settings:

| Switch | What it allows |
|---|---|
| Smart charging | Power limits sent by the server (`SetChargingProfile`, `ClearChargingProfile`). |
| Firmware updates and diagnostics logs | Firmware install (`UpdateFirmware`) and diagnostics log requests (`GetDiagnostics`, or `GetLog` on OCPP 2.0.1). |
| Local authorization list | The site's ID tag list is sent to the charge point (`SendLocalList`), so it can decide offline. |

All three are **off by default**, including for charge points that existed before this version. The server sends a feature's message only when its switch is on, so hardware that lacks a feature is never sent a message it cannot answer. After an upgrade, turn on the switches for the charge points that support them.

## Firmware and diagnostics logs

Files are kept on the server's local disk, under `<data directory>/files/firmware` and `<data directory>/files/diagnostics`. The database holds each file's name, size and SHA-256 checksum.

- **Firmware page** (Charge point features > Firmware and diagnostics): upload, name, version, vendor, model and notes, edit, download and delete. The file is uploaded up to 200 MB.
- **Diagnostics logs** appear on the same page, filtered by charge point. Each can be downloaded or deleted. Uploads are limited to 100 MB.
- **Sending firmware:** on a charge point's page, choose a firmware image and press Install. The charge point receives a link that is signed and valid for three days. It works only for that image.
- **Requesting diagnostics:** on the charge point's page, press Request diagnostics log. The charge point receives a one-time upload address valid for 48 hours. The log then appears on the Firmware page.

Limits to know about:

- Firmware is **not** cryptographically signed by the server, so the charge point must check the image itself if it can. Only upload firmware from the vendor.
- Deleting a firmware image also stops any charge point that has not yet downloaded it.
- The site needs its public web address set (the PUBLIC_URL setting) before a charge point can reach the file or the upload address.

## Smart charging

Admins set a limit in amps for the whole charge point or for one connector, and remove it. This is a fixed limit.

## Load balancing

If a site's electrical supply cannot run every charge point at full power at once, turn on load balancing under Charge point features > Load balancing and enter the site supply in kW.

- While load balancing is on, each charge point with smart charging on that is charging shares the supply equally, rounded down to whole amps and capped at the connector's own maximum. Each connector has a minimum of 6 A. If the supply cannot give every charging connector that minimum, the result is reported as over capacity.
- A connector that is not charging is left at its own maximum, so the next car starts at full power.
- The balance is worked out again when a session starts or stops, and on each change to the settings. Limits are sent only when they change.
- Load balancing overrides a manual limit set on a charge point's page. Turn load balancing off to return to manual limits.
- Charge points that are offline are skipped. They are set when they reconnect and the next balance runs.
- The supply is assumed to be single-phase at 230 V per connector, unless a connector has a voltage set in its details.

## Local authorization list

Under Charge point features > Local authorization list, add ID tags as:

- **Accepted**: may charge on a charge point that keeps the list, including while offline.
- **Blocked**: refused everywhere. The server also refuses blocked tags in its own authorization.

The whole list (up to 500 entries) is sent after each change to every connected charge point that has the switch on. Blocking a tag takes effect offline only after the list reaches the charge point, so a charge point that is offline keeps the old list until it reconnects and receives the new one.

## OCPP 2.0.1

Charge points can connect with OCPP 1.6J or OCPP 2.0.1. The version is negotiated on connection. Each session is billed and recorded the same way on both versions.

Supported on 2.0.1:

- Connection: `BootNotification`, `Heartbeat`, `StatusNotification`, `DataTransfer`
- Authorization: `Authorize`, with blocked tags refused
- Sessions: `TransactionEvent` (Started, Updated, Ended) with meter values and billing. A session that starts with an unauthorized tag is stopped with `RequestStopTransaction`.
- Meter values: `MeterValues`
- Firmware and logs: `FirmwareStatusNotification`, `LogStatusNotification`
- Commands sent by the server: stop a session, unlock a connector, reset, trigger a message, change availability, clear cache, firmware update, diagnostics log, charging limits, and the local list

Not supported on 2.0.1 in this version:

- Configuration (`GetConfiguration` and `ChangeConfiguration`, which are `GetVariables` and `SetVariables` on 2.0.1)
- Reservations
- Device model reporting, and security profiles that use certificates
- Start of a session by the server (`RequestStartTransaction`)
- Charge points with more than one EVSE. Connector numbers map to EVSE 1.

Commands with no 2.0.1 equivalent in this version are refused with a message, and nothing is sent. The OCPP 2.0.1 message shapes are checked against the official JSON schema on both sides of the connection.

## Tax

Tax rules are set under Billing > Tax rules. Each rule has:

- a **rate**, in percent (for example 20 for 20%);
- a **mode**: added on top of the price (exclusive), or already included in it (inclusive);
- **what it applies to**: every session, sessions priced per kWh, or sessions priced per minute;
- **where it applies**: the whole site, one zone, or one charge point;
- an optional **validity window** and a **priority** (lower numbers are applied first).

Rules combine like this: inclusive rules are taken out of the price first, and the remaining net amount then gets the added rules. Added rules do not compound on each other. Each tax is rounded half-up to the cent.

Use **Check a price** on the Tax rules tab to see how a price would be taxed before any driver is charged.

Tax is worked out when a session ends, and stored on the charge with the rules that applied. Changing a rule later does not change charges already made.

## Receipts and invoices

- **Consumer receipts** are issued automatically when a charge is paid. Each receipt has a number such as `RCP-2026-00001`.
- **B2B invoices** are issued to a customer from paid charges you select. Each invoice has a number such as `INV-2026-00001` and a due date from the payment terms. A charge goes on one invoice only.
- **Credit notes** correct an invoice. They repeat its lines with negative amounts, and an invoice can be credited once.
- Documents are printable HTML pages. Use the browser's print to save a PDF.
- Numbers come from a counter per site and document type, updated in the same transaction as the document, so they do not repeat or skip.

Limits to know about:

- E-mail: if e-mail is set up for the site, receipts can be e-mailed to drivers who gave an e-mail address, and invoices to the customer's invoice address. Both are off until switched on in the Business details tab; the switch is refused while e-mail is not set up. The e-mail carries a link to the receipt, served at `/api/receipts/<charge token>`. Invoice e-mails carry a text summary, not the printed page.
- Tax exemption is for business (B2B) customers. An exempt customer's invoices carry no tax, and print the exemption reference. Reverse charge and per-customer tax rules are not supported. Consumer receipts are always taxed.
- Price shown to drivers does not yet say whether tax is included.
- A card hold is placed before tax is known, so a hold can be smaller than the final total. The difference is charged through the usual payment link.
- Rules that name a zone or charge point that has been deleted are ignored, rather than blocking charges.

Before you take payment for charging, have your accountant confirm the rules and the document requirements for your jurisdiction. The software applies the rules you enter. It does not know what your jurisdiction requires.

## Charging plans (subscriptions)

Under Charging plans, an admin defines plans: a name, a monthly fee in cents, and a discount percentage on sessions. A driver is enrolled by their ID tag.

- A subscriber's sessions get the plan's discount before tax. The discount is recorded on the charge.
- Only one active plan per ID tag. A plan with subscribers cannot be deleted; close it to new subscribers instead.
- The monthly fee is billed to the subscriber's billing customer, when one is chosen at enrolment. The "Bill this month's plan fees" button puts the fees on one invoice per customer. Each subscription is billed once per calendar month, so pressing the button again does nothing for a month already billed.
- Subscribers with no billing customer get the discount, but the server does not collect their fee. Collecting consumer subscription fees needs a payment arrangement that is not built yet.

## Reversing a charge

On the Receipts tab, Reverse records that a paid or unpaid charge was reversed, with a required reason. The receipt then shows the reversal and its reason. A reversed charge leaves the list of charges that can be invoiced.

Reversal records the change only. It does not move money: refund the payment in your payment provider. If the charge is already on an invoice, issue a credit note for that invoice too. The reply tells you which.

## Webhooks

Under Webhooks, add an endpoint with an https address and choose the events to send, or all of them. The secret is shown once, when the endpoint is created. Store it with the receiving system.

Events: charge paid, charge reversed, session started, session stopped, station faulted, invoice issued, subscription started, subscription cancelled.

Each post is JSON, with headers `X-Plugyard-Event`, `X-Plugyard-Delivery`, and `X-Plugyard-Signature`. The signature is `t=<unix seconds>,v1=<HMAC-SHA256 of "<t>.<body>">`, keyed with the endpoint's secret. Check it, and refuse a timestamp more than five minutes old.

A post that fails is retried after one minute, then two, four, and so on, up to six hours, and given up after ten attempts. The delivery log shows each event's result and lets you retry one. Addresses on this machine or a private network are refused, unless the operator sets WEBHOOK_ALLOW_PRIVATE_NETWORKS=1.
