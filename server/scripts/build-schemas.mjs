// Generates the Postgres and MariaDB Prisma schemas from the canonical schema
// (prisma/schema.prisma, which uses SQLite and is the source of truth for the
// models).
//
// Output: prisma/providers/<provider>/schema.prisma, with its own migrations folder.
//
// Usage:
//   node scripts/build-schemas.mjs           write the generated schemas
//   node scripts/build-schemas.mjs --check   fail if a generated schema is out of date (for CI)
//
// Fields marked `// @longtext` in the canonical schema become `@db.Text` on
// MariaDB, because Prisma's default VARCHAR(191) is too short for certificates,
// encrypted secrets and long JSON. Postgres needs no annotation: String is TEXT.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prismaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma');
const canonicalPath = path.join(prismaDir, 'schema.prisma');

export const PROVIDERS = ['postgresql', 'mysql'];

const HEADER = (provider) =>
  `// GENERATED from prisma/schema.prisma by scripts/build-schemas.mjs. Do not edit.\n` +
  `// Provider: ${provider}\n\n`;

export function buildSchema(canonical, provider) {
  const datasourceMatches = canonical.match(/provider = "sqlite"/g) ?? [];
  if (datasourceMatches.length !== 1) {
    throw new Error('Expected exactly one `provider = "sqlite"` line in the canonical schema.');
  }
  let out = canonical.replace('provider = "sqlite"', `provider = "${provider}"`);

  out = out
    .split('\n')
    .map((line) => {
      if (!line.includes('// @longtext')) return line;
      const stripped = line.replace(/\s*\/\/ @longtext\s*$/, '');
      if (provider !== 'mysql') return stripped;
      // Add @db.Text right after the `String` / `String?` type token.
      return stripped.replace(/(\s)(String\??)(\s|$)/, '$1$2 @db.Text$3').replace(/ {2,}@/g, ' @');
    })
    .join('\n');

  return HEADER(provider) + out;
}

export function providerSchemaPath(provider) {
  return path.join(prismaDir, 'providers', provider, 'schema.prisma');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const canonical = fs.readFileSync(canonicalPath, 'utf8');
  let stale = false;

  for (const provider of PROVIDERS) {
    const target = providerSchemaPath(provider);
    const next = buildSchema(canonical, provider);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    if (current === next) {
      console.log(`up to date: ${path.relative(process.cwd(), target)}`);
      continue;
    }
    if (checkOnly) {
      console.error(`out of date: ${path.relative(process.cwd(), target)} (run node scripts/build-schemas.mjs)`);
      stale = true;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log(`wrote ${path.relative(process.cwd(), target)}`);
  }

  if (stale) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
