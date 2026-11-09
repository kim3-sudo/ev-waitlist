# Plan: sign firmware before updates

**Status: planned, not built.** Today, the server stores a SHA-256 checksum for each firmware file. A checksum confirms a file wasn't damaged, but it doesn't prove who made it. Anyone who can upload a file can also update its checksum.

This plan protects against:

1. A malicious or mistaken upload.
2. A file changed on the server's disk after upload.
3. A file changed in transit, after HTTPS.
4. A stolen signing key. Limit the damage as well as preventing theft.

## Who signs

- **Preferred:** the charge point vendor signs. The server stores and forwards the file and never holds a signing key.
- **Fallback:** you sign with an offline key on a release machine, for vendors that don't sign. Register the public certificate with the server.

## Where checks happen

Run both checks.

- **Upload (server).** Upload the firmware with a detached signature and signing certificate. The server verifies the SHA-256 digest and the signature against the site's trust anchors. It stores the result as `signatureStatus`: `UNSIGNED`, `VERIFIED`, or `REJECTED`. Before each send, the server rechecks the digest.
- **Charge point (device).** Send the signature and certificate with the update (OCPP 2.0.1 `UpdateFirmware` carries `signingCertificate` and `signature`). The charge point verifies them before installing. If the check fails, it reports `InvalidSignature` in `FirmwareStatusNotification`, and the server logs it.

The device check matters most. It catches a server compromised after upload.

## Policy

Add a per-site setting: **require signed firmware**.

- **Off (default):** unsigned firmware can be sent, with a warning.
- **On:** the server sends only `VERIFIED` packages and explains refusals on the charge point page.

## Keys and trust

- Store a list of CA certificates per site as trust anchors. Store no private keys.
- Add a new anchor before you remove the old one. Packages signed under a removed anchor become `REJECTED`.
- The first release skips revocation (CRL and OCSP). To block a compromised vendor certificate, remove it from the anchors. That stops new uploads but not firmware already installed.
- Use ECDSA P-256 with SHA-256, or Ed25519. Node's built-in `crypto` supports both.

## Data changes

- `FirmwarePackage`: add `signatureAlgorithm`, `signature`, `signingCertificate` (PEM), `signatureStatus`, `verifiedAt`, and `verifiedError`.
- Site settings: add `requireSignedFirmware` (boolean) and `trustAnchors` (PEM list).

## Admin interface

- Upload form: optional signature and certificate files, with the result shown right away.
- Package list: a badge for each status, and the signer's subject name.
- Update button: disabled for unverified packages under the strict policy, with the reason shown.

## Tests

- Valid signature from a trusted CA: `VERIFIED`.
- One changed byte: `REJECTED` (digest mismatch).
- Untrusted CA: `REJECTED`.
- Expired certificate: `REJECTED`.
- Strict policy, unsigned package: send refused, and nothing reaches the charge point.
- `UpdateFirmware` with signature fields passes the OCPP 2.0.1 schema check.
- `InvalidSignature` from a charge point is logged as an event.

## Rollout

1. Verify at upload, and record the status. Don't change sending.
2. Add the strict policy, and send signature fields to OCPP 2.0.1 charge points.
3. Confirm device checks with one vendor, using a deliberately altered test image.
4. Add revocation checks if operators need them.

## Open questions

1. Do your vendors sign firmware, and can they supply the certificate chain?
2. OCPP 1.6 has no standard signature fields. Accept a vendor-specific method, or keep checksums only for those chargers?
3. Should new sites default to the strict policy?
4. Where are offline signing keys kept, and who can sign a release?
