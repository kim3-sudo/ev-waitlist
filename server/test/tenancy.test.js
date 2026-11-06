import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { getSettings } from '../src/services/settingsService.js';
import { resetDb } from './support/db.js';

const SITE_B = 'site-b';

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });
});

test('rows created in one site are invisible from another', async () => {
  await runWithTenant(SITE_B, () => prisma.zone.create({ data: { name: 'Garage' } }));

  assert.equal((await prisma.zone.findMany()).length, 0, 'default site sees no site-B zones');
  assert.equal((await runWithTenant(SITE_B, () => prisma.zone.findMany())).length, 1);
});

test('a lookup by id does not cross sites', async () => {
  const zone = await runWithTenant(SITE_B, () => prisma.zone.create({ data: { name: 'Garage' } }));

  assert.equal(await prisma.zone.findUnique({ where: { id: zone.id } }), null);
  assert.equal(await prisma.zone.count({ where: { id: zone.id } }), 0);
});

test('the same zone name may exist once per site', async () => {
  await prisma.zone.create({ data: { name: 'Level 1' } });
  await runWithTenant(SITE_B, () => prisma.zone.create({ data: { name: 'Level 1' } }));

  assert.equal((await prisma.zone.findMany({ where: { name: 'Level 1' } })).length, 1);
  assert.equal((await runWithTenant(SITE_B, () => prisma.zone.findMany({ where: { name: 'Level 1' } }))).length, 1);
});

test('a write that names another site is refused', async () => {
  await assert.rejects(
    () => prisma.zone.create({ data: { name: 'X', tenantId: SITE_B } }),
    /attempted in site default/,
  );
});

test('a query that names another site is refused', async () => {
  await assert.rejects(() => prisma.zone.findMany({ where: { tenantId: SITE_B } }), /attempted in site default/);
});

test('settings are kept per site', async () => {
  await getSettings();
  await prisma.settings.update({ where: { tenantId: 'default' }, data: { companyName: 'Acme' } });
  const siteB = await runWithTenant(SITE_B, () => getSettings());

  assert.equal(siteB.tenantId, SITE_B);
  assert.notEqual(siteB.companyName, 'Acme');
  assert.equal((await getSettings()).companyName, 'Acme');
});

test('unscoped client sees every site', async () => {
  await runWithTenant(SITE_B, () => prisma.zone.create({ data: { name: 'Garage' } }));
  assert.equal((await rawPrisma.zone.findMany()).length, 1);
});
