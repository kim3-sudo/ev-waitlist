import bcrypt from 'bcryptjs';
import { prisma, rawPrisma } from '../db.js';
import { generateEmail, generatePassphrase } from '../utils/passphrase.js';

// On a fresh database (no admin accounts yet), creates one admin with a random
// email and passphrase and returns the credentials so they can be shown once.
// The admin must change the passphrase on first login. Returns null when any
// admin already exists, so repeated starts don't create or reset accounts.
export async function ensureFirstRunAdmin() {
  // Instance-level check: any admin in any site means the first run is over.
  const count = await rawPrisma.admin.count();
  if (count > 0) return null;

  const email = generateEmail();
  const password = generatePassphrase();
  await prisma.admin.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      mustChangePassword: true,
      // The person who sets up the installation administers all sites.
      instanceAdmin: true,
    },
  });
  return { email, password };
}

export function printFirstRunCredentials({ email, password }) {
  const lines = [
    '',
    '============================================================',
    '  FIRST RUN: admin account created',
    '',
    `  Email:       ${email}`,
    `  Passphrase:  ${password}`,
    '',
    '  Sign in with these. You will be asked to choose a new',
    '  passphrase before you can continue. This is shown once.',
    '============================================================',
    '',
  ];
  console.log(lines.join('\n'));
}
