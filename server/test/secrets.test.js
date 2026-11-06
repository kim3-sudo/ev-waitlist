import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSecrets } from '../src/bootstrap/secrets.js';

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ev-secrets-'));
}

describe('startup secrets', () => {
  it('uses values from the environment and writes nothing to disk', () => {
    const dir = freshDir();
    const secrets = loadSecrets({
      env: { JWT_SECRET: 'jwt-from-env', CONFIG_ENCRYPTION_KEY: 'key-from-env' },
      dataDir: dir,
    });
    assert.equal(secrets.jwtSecret, 'jwt-from-env');
    assert.equal(secrets.encryptionKey, 'key-from-env');
    assert.deepEqual(secrets.generated, []);
    assert.equal(fs.existsSync(path.join(dir, 'secrets.json')), false);
  });

  it('generates both secrets once, keeps them in a 0600 file, and reuses them', () => {
    const dir = freshDir();
    const first = loadSecrets({ env: {}, dataDir: dir });
    assert.deepEqual(first.generated, ['JWT_SECRET', 'CONFIG_ENCRYPTION_KEY']);
    assert.ok(first.jwtSecret.length >= 32);

    const mode = fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777;
    assert.equal(mode, 0o600);

    const second = loadSecrets({ env: {}, dataDir: dir });
    assert.deepEqual(second.generated, []);
    assert.equal(second.jwtSecret, first.jwtSecret);
    assert.equal(second.encryptionKey, first.encryptionKey);
  });

  it('never copies an environment value into the file', () => {
    const dir = freshDir();
    loadSecrets({ env: { JWT_SECRET: 'jwt-from-env' }, dataDir: dir });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
    assert.equal(onDisk.jwtSecret, undefined);
    assert.ok(onDisk.encryptionKey);
  });

  it('refuses a JWT_SECRET that is the old placeholder', () => {
    assert.throws(
      () => loadSecrets({ env: { JWT_SECRET: 'dev-secret-change-me' }, dataDir: freshDir() }),
      /JWT_SECRET is set to a placeholder/,
    );
  });

  it('refuses a CONFIG_ENCRYPTION_KEY copied from the example file', () => {
    assert.throws(
      () => loadSecrets({ env: { CONFIG_ENCRYPTION_KEY: 'change-me-to-a-long-random-string' }, dataDir: freshDir() }),
      /CONFIG_ENCRYPTION_KEY is set to a placeholder/,
    );
  });
});
