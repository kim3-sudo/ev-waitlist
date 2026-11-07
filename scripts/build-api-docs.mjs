// Builds the API reference from openapi/openapi.yaml with Redocly:
//   server/public/api-docs/index.html   the reference page (served at /api/docs)
//   server/public/api-docs/openapi.json the bundled spec (served at /api/v1/openapi.json)
// Both are generated, so they are not committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = path.join(rootDir, 'openapi', 'openapi.yaml');
const outDir = path.join(rootDir, 'server', 'public', 'api-docs');
const redocly = path.join(rootDir, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js');

mkdirSync(outDir, { recursive: true });
const run = (args) => execFileSync(process.execPath, [redocly, ...args], { cwd: rootDir, stdio: 'inherit' });

run(['lint', spec]);
run(['build-docs', spec, '-o', path.join(outDir, 'index.html')]);
run(['bundle', spec, '-o', path.join(outDir, 'openapi.json')]);
console.log(`API reference written to ${path.relative(rootDir, outDir)}/`);
