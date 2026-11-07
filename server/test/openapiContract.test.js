import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { prisma } from '../src/db.js';
import { issueApiKey } from '../src/services/serviceAccountService.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { SERVICE_ACCOUNT_PERMISSION_KEYS } from '../src/auth/permissions.js';
import { API_DOCS_DIR } from '../src/apiDocs.js';

// Keeps the OpenAPI document in step with the routes. For every operation in the
// spec, the test checks that a real route answers it, and that the route refuses a
// key which lacks the permission the spec declares.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALL = SERVICE_ACCOUNT_PERMISSION_KEYS;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

let spec;

before(() => {
  // Build the reference (lints the spec too), so the test checks what is served.
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-api-docs.mjs')], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  spec = JSON.parse(fs.readFileSync(path.join(API_DOCS_DIR, 'openapi.json'), 'utf8'));
});

// A concrete URL for a spec path. Ids are made up, so no test data is changed.
function concretePath(template) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => (name === 'connectorId' ? '1' : name === 'key' ? 'HeartbeatInterval' : 'missing-id'));
}

async function keyWith(permissions) {
  return runWithTenant(DEFAULT_TENANT_ID, async () => {
    const account = await prisma.serviceAccount.create({
      data: { name: `contract-${Math.random().toString(36).slice(2, 10)}`, permissions: JSON.stringify(permissions) },
    });
    return (await issueApiKey(account.id, { name: 'contract', expiresAt: null })).plainKey;
  });
}

function operations() {
  const list = [];
  for (const [template, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]) list.push({ template, method, op: item[method] });
    }
  }
  return list;
}

// Body for a request that should be refused before any change is made.
const sendBody = (method) => (method === 'get' || method === 'delete' ? undefined : {});

beforeEach(async () => {
  await resetDb();
});

describe('OpenAPI reference', () => {
  it('is served publicly from /api/v1/openapi.json and /api/docs', async () => {
    const json = await request(app).get('/api/v1/openapi.json');
    assert.equal(json.status, 200);
    assert.equal(json.body.openapi, '3.1.0');

    const page = await request(app).get('/api/docs/');
    assert.equal(page.status, 200);
    assert.match(page.text, /redoc/i);
  });

  it('gives every operation a unique id, a tag, and a permission', () => {
    const ids = new Set();
    for (const { template, method, op } of operations()) {
      assert.ok(op.operationId, `${method.toUpperCase()} ${template} has no operationId`);
      assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`);
      ids.add(op.operationId);
      assert.ok(op.tags?.length, `${op.operationId} has no tag`);
      assert.ok('x-required-permission' in op, `${op.operationId} has no x-required-permission`);
      const permission = op['x-required-permission'];
      assert.ok(permission === 'none' || ALL.includes(permission), `${op.operationId} names unknown permission ${permission}`);
    }
  });

  for (const { template, method, op } of operations()) {
    const permission = op['x-required-permission'];
    if (permission === 'none') continue;

    it(`${op.operationId} (${method.toUpperCase()} ${template}) is answered and needs ${permission}`, async () => {
      const url = `/api/v1${concretePath(template)}`;
      const withEverything = await keyWith(ALL);
      const answered = await request(app)[method](url).set('Authorization', `Bearer ${withEverything}`).send(sendBody(method));
      assert.notEqual(answered.body?.code, 'NOT_FOUND', `no route for ${method.toUpperCase()} ${template}`);
      assert.notEqual(answered.status, 401);
      assert.notEqual(answered.status, 403, `full key was refused: ${JSON.stringify(answered.body)}`);

      const withoutIt = await keyWith(ALL.filter((p) => p !== permission));
      const refused = await request(app)[method](url).set('Authorization', `Bearer ${withoutIt}`).send(sendBody(method));
      const readOnly = refused.status === 405;
      if (!readOnly) {
        assert.equal(refused.status, 403, `${method.toUpperCase()} ${template} without ${permission}: ${refused.status}`);
        assert.deepEqual(refused.body.missing, [permission]);
      }
    });
  }
});
