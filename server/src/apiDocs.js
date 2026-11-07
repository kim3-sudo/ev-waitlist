import { fileURLToPath } from 'node:url';

// Where `npm run docs:api:build` writes the Redocly HTML page and the bundled
// OpenAPI document. Served by app.js (/api/docs) and the v1 API (/api/v1/openapi.json).
export const API_DOCS_DIR = fileURLToPath(new URL('../public/api-docs/', import.meta.url));
