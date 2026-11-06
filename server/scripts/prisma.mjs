// Runs the Prisma CLI with the project-root .env loaded, so DATABASE_URL is
// found no matter which directory it's run from. Usage: node scripts/prisma.mjs <prisma args>
//
// DATABASE_PROVIDER picks the database: sqlite (default), postgresql or mysql (MariaDB).
// Each provider has its own schema and migrations folder. Unless --schema is
// given, the matching schema is used. Generated provider schemas come from
// scripts/build-schemas.mjs.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/loadRootEnv.js';
import { providerSchemaPath, PROVIDERS } from './build-schemas.mjs';

const SUPPORTED = ['sqlite', ...PROVIDERS];

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
if (!SUPPORTED.includes(provider)) {
  console.error(`DATABASE_PROVIDER must be one of: ${SUPPORTED.join(', ')} (got "${provider}").`);
  process.exit(1);
}

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The SQLite database lives in <project root>/data (see docs/install.md). Create the folder so Prisma can open the file.
if (provider === 'sqlite') fs.mkdirSync(path.join(serverDir, '..', 'data'), { recursive: true });
const schemaPath =
  provider === 'sqlite'
    ? path.join(serverDir, 'prisma', 'schema.prisma')
    : providerSchemaPath(provider);

const args = process.argv.slice(2);
const hasSchemaArg = args.some((a) => a === '--schema' || a.startsWith('--schema='));
// `migrate diff` takes its schema paths as explicit --from/--to flags instead of --schema.
const isDiff = args[0] === 'migrate' && args[1] === 'diff';
if (!hasSchemaArg && !isDiff) args.push('--schema', schemaPath);

const require = createRequire(import.meta.url);
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
