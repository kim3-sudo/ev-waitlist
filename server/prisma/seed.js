import '../src/loadRootEnv.js';
import { PrismaClient } from '@prisma/client';
import { ensureFirstRunAdmin, printFirstRunCredentials } from '../src/services/firstRunService.js';

const prisma = new PrismaClient();

// Safe to run on every start: only acts when the database has no admin yet.
const credentials = await ensureFirstRunAdmin();
if (credentials) {
  printFirstRunCredentials(credentials);
} else {
  console.log('Admin account already exists; skipping first-run setup.');
}

await prisma.$disconnect();
