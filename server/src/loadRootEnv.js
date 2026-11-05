// Loads the project-root .env file (../.env, next to package.json at the top
// level). Import this before anything that reads process.env. Values already set
// in the shell or by a test win over the file, because dotenv never overrides them.
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rootEnvPath = path.resolve(serverDir, '..', '.env');

loadDotenv({ path: rootEnvPath, quiet: true });
