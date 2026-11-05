// Preloaded via `node --import` before any test file (or the app code it
// imports) runs, so DATABASE_URL etc. are already set by the time
// src/config.js loads the root .env (dotenv doesn't override already-set env
// vars, so these values win over the file).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.PUBLIC_URL = 'http://localhost:4000';
process.env.CONFIG_ENCRYPTION_KEY = 'test-config-encryption-key';

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
