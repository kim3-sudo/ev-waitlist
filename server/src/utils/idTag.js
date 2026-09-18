import { randomBytes } from 'node:crypto';

// OCPP 1.6 idTag is a CiString20Type (max 20 chars). Keep it short and
// URL/QR-friendly for the confirmation the driver gets.
export function generateIdTag() {
  return randomBytes(6).toString('hex').toUpperCase(); // 12 chars
}
