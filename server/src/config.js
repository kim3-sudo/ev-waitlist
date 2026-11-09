import './loadRootEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecrets } from './bootstrap/secrets.js';

// Instance-wide settings only: what the server needs before it can reach the
// database, plus the two secrets that protect the whole installation. Everything
// that can differ between sites (public URLs, CORS origin, reservation window,
// payment keys, webhook secrets) is per site. Read it with
// services/runtimeConfig.js `siteConfig()`, never from here.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(serverDir, '..');

// Local data that must not be committed (the SQLite database, generated secrets)
// lives in <project root>/data. See docs/install.md.
const defaultDataDir = path.join(projectRoot, 'data');
const legacyDataDir = path.join(serverDir, 'data');

function dataDirToUse() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // Installs from before the move kept secrets.json in server/data. Keep reading it there,
  // rather than generating new keys, until the file is moved.
  const legacy =
    fs.existsSync(path.join(legacyDataDir, 'secrets.json')) && !fs.existsSync(path.join(defaultDataDir, 'secrets.json'));
  if (legacy) {
    console.log(`[config] Using ${legacyDataDir}. Move secrets.json to ${defaultDataDir} to finish the move.`);
  }
  return legacy ? legacyDataDir : defaultDataDir;
}

const secrets = loadSecrets({
  env: process.env,
  dataDir: dataDirToUse(),
});

if (secrets.generated.length) {
  console.log(
    `[config] Generated ${secrets.generated.join(' and ')} in ${secrets.file}. ` +
      'Back this file up: losing CONFIG_ENCRYPTION_KEY makes saved payment secrets unreadable.',
  );
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Local data folder (database, generated secrets, stored files).
  dataDir: dataDirToUse(),
  // Signs login sessions.
  jwtSecret: secrets.jwtSecret,
  // Encrypts secret values stored in the database. Must stay the same across
  // restarts: changing it makes saved secrets unreadable (re-enter them after).
  encryptionKey: secrets.encryptionKey,
};
