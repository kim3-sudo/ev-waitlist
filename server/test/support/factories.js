import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { prisma } from '../../src/db.js';

let counter = 0;
function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}${counter}@example.com`;
}

// Creates an Admin row directly (bypassing the API) for test fixtures.
// Pass `password: null` for an SSO-only account, or `mfa: true` to enroll a
// deterministic TOTP secret you can generate live codes for with
// `totpCode(admin.mfaSecret)`.
export async function createAdmin({ email, password = 'Password123!', mfa = false } = {}) {
  const mfaSecret = mfa ? authenticator.generateSecret() : null;
  return prisma.admin.create({
    data: {
      email: email ?? uniqueEmail('admin'),
      passwordHash: password ? await bcrypt.hash(password, 10) : null,
      mfaEnabled: mfa,
      mfaSecret,
    },
  });
}

export function totpCode(secret) {
  return authenticator.generate(secret);
}
