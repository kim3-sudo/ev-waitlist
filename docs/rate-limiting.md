# Rate limiting

The server limits how often one address, account, or sign-in can make requests. This slows password and code guessing, and keeps one client from flooding the server.

A request over its limit gets `429 Too Many Requests` with a `Retry-After` header (seconds) and a body of `{ "error": "...", "code": "RATE_LIMITED", "retryAfterSeconds": 30 }`. Other responses on limited routes carry `RateLimit-Limit` and `RateLimit-Remaining`.

## The limits

Each limit is a count over a window of time. The defaults are:

| Rule | Counts | Default |
| --- | --- | --- |
| `general.ip` | Every API request from one address (payment webhooks and `/api/health` are exempt) | 600 per 60 s |
| `authenticated.session` | Requests to `/api/admin` and `/api/v1` made with one sign-in or API key | 1200 per 60 s |
| `login.ip` | Password sign-in attempts from one address, right or wrong | 20 per 15 min |
| `login.account` | Wrong passwords for one e-mail address | 10 per 15 min |
| `mfa.ip` | Two-factor codes from one address | 20 per 15 min |
| `mfa.account` | Wrong two-factor codes for one account | 5 per 15 min |
| `signInCode.ip` | Driver sign-in code requests and attempts from one address | 30 per 15 min |
| `publicWrite.ip` | Changes made without signing in (joining the waitlist, starting a charge, reporting) from one address | 60 per 60 s |
| `deviceFiles.ip` | Firmware downloads and diagnostics uploads from one address | 60 per 60 s |
| `liveStreams.ip` | Live-update streams one address can hold open at once | 20 open |

How the counts work:

- The `.account` rules count **failures only**. Right passwords and codes do not use them up. Once an account reaches its limit, it cannot sign in until the window passes, even with the right password. This stops guessing from many addresses, but it also lets someone lock a known e-mail address out for a while. Keep the limit high enough that this is a nuisance, not an outage, and watch the audit log.
- The counts use a sliding window, so a client cannot send a double burst at a window's edge.
- IPv6 addresses count by their first 64 bits.
- The counts are kept in the server's memory and start from zero on restart. With more than one server process, each keeps its own count, so the effective limit is the limit times the number of processes.

Not covered: OCPP charge point connections (they need a connection key; see [Charge point features](charge-point-features.md#connection-keys)) and the OCPI roaming endpoints under `/ocpi`.

## Changing the limits

An administrator with the **Change request rate limits** permission (`rateLimits.manage`) who is also the installation administrator can change them, because the limits cover every site.

- `GET /api/admin/rate-limits` lists each rule with its current value, default, and allowed range.
- `PUT /api/admin/rate-limits` changes rules. Send only the ones to change:

  ```json
  { "rules": { "login.ip": { "limit": 10, "windowSeconds": 600 }, "general.ip": { "enabled": false } } }
  ```

  `limit` is a whole number (each rule has a floor, such as 3 for the account rules, so a typo cannot lock everyone out). `windowSeconds` is 1 to 86400. `liveStreams.ip` has no window. `enabled: false` turns a rule off.
- `DELETE /api/admin/rate-limits` puts every limit back to its default.

A change applies to new requests at once on the server that received it, and within 30 seconds on other server processes. Changes are recorded in the audit log (`admin.rate-limits.update`, with the old and new values). Requests refused at sign-in or for sign-in codes are recorded as `rateLimit.exceeded`, at most once every five minutes per rule and address.

## Behind a reverse proxy

Limits count by the address the server sees. Behind a proxy or load balancer, that is the proxy's address unless the server is told to trust the proxy's `X-Forwarded-For` header, which would put all your users in one bucket. Set `TRUST_PROXY` in `.env`:

| Value | Meaning |
| --- | --- |
| `1` | One proxy sits in front of the server (the usual case) |
| `2` | Two proxies in a row |
| `loopback` or an address list | Trust these proxy addresses |
| unset (default) | Trust nobody. Use the connection's own address |

Set it only to what is really in front of the server. A value that is too high lets a client choose its own address and skip the limits. The audit log uses the same address.

## Turning limits off

`RATE_LIMIT_DISABLED=1` in the server's environment turns off every rule. It exists for tests and for debugging. Do not use it in production.
