// Runs the Prisma CLI with the project-root .env loaded, so DATABASE_URL is
// found no matter which directory it's run from. Usage: node scripts/prisma.mjs <prisma args>
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import '../src/loadRootEnv.js';

const require = createRequire(import.meta.url);
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
