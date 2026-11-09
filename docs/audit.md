# Audit log

Open **Admin > Audit log** to see changes, sign-ins, and refused requests.

## What you'll see

- Changes and refusals in the admin app and API. The log lists field names, not values. Reads aren't logged.
- Important changes show before and after values. Secret fields show `[set]` or `[cleared]`.
- Sign-ins show the email used and the outcome. Passwords are never logged.
- Privacy actions show the queue entry ID, never driver details.

## Permissions

- `audit.view`: read the log, check the chain, and see retention and SIEM status.
- `audit.export`: download a CSV and see SIEM export status.
- Only the installation administrator with `system.manage` can change retention or address logging.

Site administrators see their site's events. The installation administrator also sees installation-wide events.

## Check tamper evidence

Each event stores `prevHash` and `hash` (SHA-256 of its fields plus `prevHash`). Select **Check the chain** to find any edited or deleted event. Retention removes the oldest events. The new oldest event still checks against its own hash.

## Set retention and client addresses

- **Retention:** choose 7, 30 (default), 90, 180, 365, or 730 days. The server deletes old events hourly. With a SIEM, it deletes only events already sent.
- **Client addresses:** record them in full, truncated (IPv4 to /24, IPv6 to /48), or not at all. Choose what your jurisdiction requires.

## Send events to a SIEM

Set these variables before you start the server. Delivery is at-least-once, so deduplicate on `seq` or `hash`.

| Variable | Meaning |
| --- | --- |
| `AUDIT_SYSLOG_URL` | `tls://host:6514` (recommended) or `tcp://host:514`. Leave unset to turn off export. |
| `AUDIT_SYSLOG_FORMAT` | `json` (default) or `cef` |
| `AUDIT_SYSLOG_CA_FILE` | PEM certificate of the CA that signed the SIEM's certificate |
| `AUDIT_SYSLOG_CERT_FILE`, `AUDIT_SYSLOG_KEY_FILE` | Client certificate and key, if the SIEM requires them (PEM) |
| `AUDIT_SYSLOG_APP_NAME` | APP-NAME field (default `plugyard`) |
| `AUDIT_SYSLOG_FACILITY` | Syslog facility (default 16, local0) |

Already use a log shipper? Skip the built-in exporter, and have the shipper read the server's log output.

## Handle failed writes

Recording never blocks a request. If a write fails, the server logs an error that names the action, and the request completes. The audit page counts failures since the server started.
