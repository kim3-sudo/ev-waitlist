# Audit log

The audit log records what happens in the installation: changes to charge points, prices, users, roles, settings, service accounts and API keys; sign-ins (successful and failed); and requests that were refused. Open **Admin > Audit log**.

## What is recorded

- **Changes and refusals** in the admin app and the API are recorded automatically. Successful reads are not. A change records field names, never values.
- **Important changes** record field-level before and after values. Secret fields are recorded as `[set]` or `[cleared]`, never their value.
- **Sign-ins** record the e-mail the sign-in was attempted with, and the outcome. Passwords are never recorded.
- **Privacy actions** (retention changes, erasure of a driver's data) record the queue entry ID, never the driver's details.

## Permissions

- `audit.view` reads the log, checks the chain, and sees the retention and SIEM status.
- `audit.export` downloads the log as CSV and sees the SIEM export status. It is separate from `audit.view`.
- Changing retention or address logging needs the installation administrator and `system.manage`.

A site's administrators see their site's events. The installation administrator also sees installation-wide events (sites, the operator, network-wide settings).

## Tamper evidence

Every event stores `prevHash` (the hash of the event before it) and `hash` (a SHA-256 of its own fields plus `prevHash`). Changing or deleting an event breaks the chain, and **Check the chain** reports where. Retention removes the oldest events; the oldest remaining event then becomes the starting point, which still checks against its own hash.

Each SIEM message also carries `seq` and `hash`, so the SIEM can run the same check.

## Retention and addresses

- **Retention** is 7, 30 (default), 90, 180, 365 or 730 days. Events past it are deleted hourly. When a SIEM is configured, only events already sent to it are deleted.
- **Client addresses** are recorded in full, truncated (IPv4 to /24, IPv6 to /48), or not at all. Choose the level your jurisdiction requires.

## Sending events to a SIEM

Set these before starting the server. The server sends every event, in order, over TLS (or plain TCP on a trusted network). Delivery is at-least-once: after a restart an event can arrive twice, so deduplicate on `seq` or `hash`.

| Variable | Meaning |
| --- | --- |
| `AUDIT_SYSLOG_URL` | `tls://host:6514` (recommended) or `tcp://host:514`. Unset means no export. |
| `AUDIT_SYSLOG_FORMAT` | `json` (default) or `cef` |
| `AUDIT_SYSLOG_CA_FILE` | PEM certificate of the CA that signed the SIEM's certificate. Server certificates are always verified. |
| `AUDIT_SYSLOG_CERT_FILE`, `AUDIT_SYSLOG_KEY_FILE` | Client certificate and key, if the SIEM requires one (PEM) |
| `AUDIT_SYSLOG_APP_NAME` | The APP-NAME field (default `plugyard`) |
| `AUDIT_SYSLOG_FACILITY` | Syslog facility number (default 16, local0) |

Messages are RFC 5424 with octet-counting framing (RFC 6587 / RFC 5425). The structured data carries `seq`, `hash` and `outcome`. The body is the event as JSON, or as CEF when `AUDIT_SYSLOG_FORMAT=cef`.

If your log shipper already collects files, you can skip the built-in exporter and let it read the server's log output instead.

## When an event cannot be recorded

Recording never blocks a request. If a write fails, the server logs an error naming the action that could not be recorded, and the request completes. The audit page shows how many failures have happened since the server started.
