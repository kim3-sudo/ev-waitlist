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

Admins set a limit in amps for the whole charge point or for one connector, and remove it. This is a fixed limit. It does not balance power between chargers on a shared supply. Load balancing across a site is not built yet.

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

- Receipts and invoices are not emailed automatically. The receipt page is served at `/api/receipts/<charge token>`, the same token as the charge's payment link. Drivers are not sent this link yet.
- Tax exemption certificates, reverse charge, and per-customer tax rules are not supported.
- Price shown to drivers does not yet say whether tax is included.
- A card hold is placed before tax is known, so a hold can be smaller than the final total. The difference is charged through the usual payment link.
- Rules that name a zone or charge point that has been deleted are ignored, rather than blocking charges.

Before you take payment for charging, have your accountant confirm the rules and the document requirements for your jurisdiction. The software applies the rules you enter. It does not know what your jurisdiction requires.
