// Preloaded via `node --import` before any test file (or the app code it
// imports) runs, so DATABASE_URL etc. are already set by the time
// src/config.js loads the root .env (dotenv doesn't override already-set env
// vars, so these values win over the file).
//
// Database: SQLite by default (a local test.db file). To run the suite against
// another provider, set DATABASE_PROVIDER=postgresql or mysql and
// TEST_DATABASE_URL to a database the test run may wipe, for example:
//   DATABASE_PROVIDER=postgresql TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/plugyard_test npm test
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Test requests open a fresh server each time. Reusing a kept-alive connection can
// reach a later server on a recycled port, which caused intermittent socket errors.
http.globalAgent = new http.Agent({ keepAlive: false });

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
if (provider === 'sqlite') {
  // Relative SQLite paths are resolved from the Prisma schema folder (server/prisma), so this is <root>/data/test.db.
  process.env.DATABASE_URL = 'file:../../data/test.db';
  fs.mkdirSync(path.join(serverDir, '..', 'data'), { recursive: true });
} else {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(`DATABASE_PROVIDER=${provider} needs TEST_DATABASE_URL pointing at a disposable test database.`);
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.PUBLIC_URL = 'http://localhost:4000';
process.env.CONFIG_ENCRYPTION_KEY = 'test-config-encryption-key';
// The suite signs in and calls the API far more often than a person would. rateLimit.test.js turns limits back on.
process.env.RATE_LIMIT_DISABLED = '1';

// Keep the generated Prisma client in step with schema.prisma.
execFileSync(process.execPath, ['scripts/prisma.mjs', 'generate'], { cwd: serverDir, env: process.env, stdio: 'ignore' });

// Always deploy pending migrations -- a no-op (well under a second) once the
// test DB is already current, and it means a schema change never leaves a
// stale test.db silently missing tables/columns.
execFileSync(process.execPath, ['scripts/prisma.mjs', 'migrate', 'deploy'], {
  cwd: serverDir,
  env: process.env,
  stdio: 'inherit',
});
