# Roaming (OCPI)

Roaming lets drivers who use another e-mobility provider (a partner) charge at your site. The protocol between you and the partner is OCPI 2.2.1. This software implements the **charge point operator (CPO) side**.

## What works

- **Operator identity.** Country code and party ID, under **Sites > Operator**.
- **Roaming switch per site**, under **Roaming**. It stays off until an administrator has had the terms reviewed and has ticked the acknowledgement. The acknowledgement records the time and the administrator, and it must be given again if the terms version or the warning text changes. While roaming is off, the site's OCPI address answers 403.
- **Warning for drivers.** A site with roaming on shows the required warning in the waitlist join dialog, and a driver must accept it before joining.
- **Partners.** Invite a partner under **Roaming > Roaming partners**. The invitation has a one-time registration token, which you give to the partner out of band. The partner then registers with its own credentials, and the server:
  - checks the partner's version list and endpoints;
  - gives the partner a token to use from then on;
  - sends the partner this site's stations and tariff.
- **OCPI 2.2.1 modules**, at `/ocpi/<site address>/2.2.1/...`:
  - *Credentials* (register, read, update, remove).
  - *Locations* (read, for stations with coordinates). Pushed to the partner too, including EVSE status changes.
  - *Tariffs* (read, and pushed when prices change). One tariff per site, built from the site's pricing: a per-hour time price, or a per-kWh energy price. Each time-of-day window is a restricted element, and the base price is the last element, because partners apply the first element whose restrictions match. Free charging is sent as a zero price.
  - *Tokens* (the partner pushes its drivers' tokens to you).
  - *Sessions and CDRs* for roaming drivers. A session is sent when it starts, and again when it finishes, with a CDR at the end. The CDR's cost comes from the site's pricing. Roaming sessions do not get a payment link, because the partner settles them.
  - *Commands*: start a session, stop a session, unlock a connector. Each answers at once and posts its final result to the partner's `response_url`.
- **Authorization.** A partner's driver token is checked when the charge point asks to authorize it. A connector held for a waitlisted driver is not given to a roaming token. When the partner offers a tokens endpoint, the partner decides in real time; otherwise the token's whitelist setting decides.
- **Outbound messages are queued** and retried with backoff (up to ten attempts), so a partner outage does not lose data. The queue is sent every 15 seconds, and **Send queued messages now** sends it on demand.

## What is not built or not verified

- **Not tested with a real partner.** The automated tests use a fake partner in the test process, which records what it receives. Interoperability with a real e-mobility provider, and OCPI certification, have not been tried. Expect differences in field details.
- **Connector details must be entered.** Each connector has its own standard, format, power type, maximum voltage and maximum current, set on the station form. A station is published only when it has coordinates and all its connectors are complete. Incomplete stations are left out of the location list and are not pushed to partners.
- **Station address fields are blank.** Only the station's location text is sent as the address; city, postal code and country are empty.
- **`GET` on the credentials endpoint does not return the token**, because only a hash of the token we issued is stored. The partner already holds the token.
- **Command results are sent once.** If the partner's `response_url` is unreachable at that moment, the result is logged and not retried.
- **Real charge points not tested for the new messages.** `RemoteStopTransaction` and `UnlockConnector` are sent to the charge point, but only the test double has answered them. Check your charge point supports them.
- **Only the CPO role.** Acting as a hub or as an e-mobility provider is not supported. OCPI 2.1.1 and ChargingProfiles are not supported.
- **Rate limits and mutual checks.** The OCPI address has no rate limiting beyond the server's own, and no check of the partner's IP address.
- **Live session energy.** Sessions use the meter readings at the start and the end. Readings during the session are not sent.

## What you need before roaming works

- A public HTTPS address for the OCPI endpoints, behind a reverse proxy that terminates TLS.
- A party ID, which you register yourself with the roaming scheme or agree with each partner. The software does not assign one.
- A partner agreement, and the registration token you give to the partner.
- Legal review of the roaming terms and the warning text. See the [operator checklist](operator-checklist.md#1-legal-review-legal).
- Stations with coordinates, so they can be published (set latitude and longitude on each station).
- Confirmation of each partner's OCPI version and of the connector details above.
