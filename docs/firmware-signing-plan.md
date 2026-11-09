# Plan: cryptographic signing of firmware before updates

Status: planned, not built. This plan covers how firmware is checked before it reaches a charge point.
Today, firmware is stored with a SHA-256 checksum (see [charge point features](charge-point-features.md)).
A checksum shows the file was not damaged, but not who made it. Anyone who can upload a file can
also change the checksum to match.

## What we are protecting against

1. **A malicious or mistaken upload** by someone with the firmware permission.
2. **A file changed on the server's disk** after upload.
3. **A file changed in transit**. HTTPS covers the link, but not where the file came from.
4. **A stolen signing key**. Limiting the damage matters as much as preventing theft.

## Design

### 1. Who signs

Preferred: the **charge point vendor signs the firmware**, and the server only stores and forwards it.
Then the server does not hold the signing key, and a compromised server cannot make new valid firmware.

Fallback: the **operator signs with an offline key**, for vendors that do not sign. The operator's
signing key is kept off the server, on a machine that signs releases. The public certificate is
registered with the server.

### 2. Where the check happens

Two checks, both needed:

- **At upload (server).** The admin uploads the firmware with a detached signature and the signing
  certificate. The server checks the SHA-256 digest, then verifies the signature with the
  certificate against the site's trust anchors (the CA certificates the site accepts). The result is
  stored on the package as `signatureStatus`: `UNSIGNED`, `VERIFIED`, or `REJECTED`. The server
  rechecks the stored file's digest before each send, so a file changed on disk is caught.
- **On the charge point (device).** The server sends the signature and certificate with the update
  (OCPP 2.0.1 `UpdateFirmware` carries `signingCertificate` and `signature`). The charge point
  verifies before installing. If it refuses, it reports `InvalidSignature` in
  `FirmwareStatusNotification`, which the server records as an event.

The device check is the one that matters most, because it protects against a server that has been
compromised after the upload check.

### 3. Policy

A per-site setting: **require signed firmware**.

- Off (default, to keep existing sites working): unsigned packages can be sent, and the admin sees a warning.
- On: only `VERIFIED` packages can be sent. The server refuses to send anything else, and the
  charge point page says why.

### 4. Keys and trust

- Trust anchors: a list of CA certificates per site, uploaded by the admin. No private keys are stored.
- Rotation: a new trust anchor can be added before the old one is removed. Packages signed under a
  removed anchor show `REJECTED` and cannot be sent under the strict policy.
- Revocation: not checked in the first release (no CRL or OCSP). A compromised vendor certificate
  must be removed from the trust anchors, which blocks new uploads. Already-installed firmware is not
  affected. This limit is stated to the operator.
- Algorithms: ECDSA P-256 with SHA-256, or Ed25519. Both are available in Node's built-in `crypto`
  module, so no new dependency is needed.

### 5. Data changes

`FirmwarePackage`: `signatureAlgorithm`, `signature`, `signingCertificate` (PEM),
`signatureStatus`, `verifiedAt`, `verifiedError`.

`BillingSettings`-style site settings: `requireSignedFirmware` (boolean), `trustAnchors` (PEM list).

### 6. Admin interface

- Upload form: optional signature file and certificate file, with the result shown at once.
- Package list: a badge for `UNSIGNED`, `VERIFIED`, or `REJECTED`, and the signer's subject name.
- Update action: disabled for non-verified packages when the strict policy is on, with the reason.

### 7. Testing

- Valid signature from a trusted CA: `VERIFIED`.
- One changed byte in the file: `REJECTED`, digest mismatch.
- Signature from an untrusted CA: `REJECTED`.
- Expired certificate: `REJECTED`.
- Strict policy with an unsigned package: the send is refused and nothing reaches the charge point.
- The 2.0.1 `UpdateFirmware` message with signature fields passes the official schema check, as the
  OCPP tests do now.
- A charge point reporting `InvalidSignature` is recorded as an event.

### 8. Rollout

1. Verify at upload and record the status. No change to sending.
2. Add the strict policy, and send signature fields on OCPP 2.0.1 charge points.
3. Confirm device-side checks with one vendor, using a deliberately altered test image.
4. Add revocation checks if operators need them.

## Open questions for the team

1. Do the charge point vendors we use sign their firmware, and can they supply the certificate chain?
2. OCPP 1.6 has no standard signature fields. Do we accept a vendor-specific mechanism for those
   chargers, or leave them on the checksum only?
3. Should the strict policy be the default for new sites?
4. Where are the offline signing keys kept, and who can sign a release?
