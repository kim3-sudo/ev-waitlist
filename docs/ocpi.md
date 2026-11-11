# Roaming (OCPI)

Roaming lets drivers from partner e-mobility providers charge at your sites. This software implements the charge point operator (CPO) side of OCPI 2.2.1.

**Status:** The automated tests use a fake partner. No real partner has tested this integration, and it isn't OCPI-certified. Expect field-level differences.

## Turn on roaming

1. Set your country code and party ID under **Sites > Operator**. Get the party ID from your roaming scheme or partners. The software doesn't assign one.
2. Have counsel review the terms and warning text.
3. Under **Roaming**, tick the acknowledgement and turn on roaming for the site. Give the acknowledgement again if the terms or warning change. While roaming is off, the OCPI address returns 403.
4. Enter connector details on each charge point's form: standard, format, power type, maximum voltage, and maximum current.
5. Set latitude and longitude on each charge point. The server publishes only charge points with coordinates and complete connector details.

Drivers at a roaming-enabled site must accept the warning before they join the waitlist.

## Add a partner

1. Go to **Roaming > Roaming partners** and invite a partner.
2. Send the one-time registration token to the partner, outside the software.
3. The partner registers with its own credentials. The server checks its version and endpoints, issues it a token, and sends it your stations and tariff.

## What the server sends and receives

OCPI modules live at `/ocpi/<site address>/2.2.1/...`.

- **Credentials:** register, read, update, and remove. `GET` never returns the token, because the server stores only a hash.
- **Locations:** the server sends stations with coordinates, including EVSE status changes.
- **Tariffs:** one tariff per site, based on your pricing. Time windows are restricted elements, and the base price comes last. Free charging is a zero price. The server pushes updates when prices change.
- **Tokens:** partners push their driver tokens to you.
- **Sessions and CDRs:** the server sends a session at start and finish, and a CDR at the end. Partners settle roaming sessions, so no payment link is sent.
- **Commands:** start a session, stop a session, or unlock a connector. The server acknowledges at once and posts the final result to the partner's `response_url`.

## Authorize drivers

When a charge point asks to authorize a partner's token, the server checks it. The server won't give a connector held for a waitlisted driver to a roaming token. If the partner offers a tokens endpoint, the partner decides in real time. Otherwise, the token's whitelist setting decides.

## What the server will call

A partner gives the server addresses to call, so the server treats them as untrusted:

- Addresses must be `https://` and must not resolve to a private, loopback, link-local or reserved network. The name is looked up when each request is sent.
- Every address a partner lists (its version list, its 2.2.1 endpoints, and the URLs it sends for command results) must be on the **same host and port** as the versions address the partner registered with. The server sends the partner's token only there. A partner whose modules live on a different host is refused with a message that names the address.
- Redirects are not followed, and a reply over 2 MB is dropped.
- To roam with a partner on a private network, or over `http://`, set `OCPI_ALLOW_PRIVATE_NETWORKS=1` on the server.

## Handle outages

Outbound messages go into a queue, and the server retries each one with backoff up to ten times. The queue sends every 15 seconds. To send now, select **Send queued messages now**.

## Know the limits

- **Address fields.** The station's address sends only its location text. City, postal code, and country stay blank.
- **Command results.** The server sends each result once. If the `response_url` is unreachable, the server logs the failure and doesn't retry.
- **Charge points.** Check that yours support `RemoteStopTransaction` and `UnlockConnector`. Only the test double has answered them.
- **Session energy.** The server uses meter readings from the start and end of a session. It doesn't send readings during the session.
- **Scope.** The server implements only the CPO role. It doesn't support the hub or e-mobility provider roles, OCPI 2.1.1, or ChargingProfiles.
- **Rate limits.** The OCPI address has only the server's own rate limiting. It doesn't check partner IP addresses.

## Before you launch

- A public HTTPS address behind a TLS-terminating proxy.
- A party ID.
- A partner agreement and a registration token for each partner.
- Legal review of the roaming terms and warning. See the [operator checklist](operator-checklist.md#1-legal-review-legal).
- Stations with coordinates and complete connector details.
- Confirmation that each partner supports OCPI 2.2.1.
