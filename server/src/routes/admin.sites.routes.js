import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma, rawPrisma } from '../db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import { loadAllSites, loadSiteConfig } from '../services/runtimeConfig.js';

// Mounted behind sites.manage and requireInstanceAdmin: only the installation
// administrator creates, renames, or deletes sites.
export const adminSitesRouter = Router();

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
// Web addresses are shared by the whole installation, so a new site starts with the default site's.
const INHERITED_SETTINGS = ['publicUrl', 'corsOrigin', 'webUrl'];

function siteView(t) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    createdAt: t.createdAt,
    stationCount: t._count?.stations ?? 0,
    adminCount: t._count?.admins ?? 0,
    isDefault: t.id === DEFAULT_TENANT_ID,
  };
}

adminSitesRouter.get('/', async (req, res) => {
  const sites = await rawPrisma.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { stations: true, admins: true } } },
  });
  res.json(sites.map(siteView));
});

adminSitesRouter.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
  if (!name || name.length > 80) return res.status(400).json({ error: 'name is required (80 characters at most)' });
  if (!SLUG_PATTERN.test(slug)) {
    return res.status(400).json({ error: 'slug must be 2-40 letters, numbers or hyphens, starting with a letter or number' });
  }
  if (slug === DEFAULT_TENANT_ID) return res.status(400).json({ error: `"${slug}" is reserved for the first site` });
  if (await rawPrisma.tenant.findUnique({ where: { slug } })) {
    return res.status(409).json({ error: 'A site with that address already exists' });
  }

  const tenant = await rawPrisma.tenant.create({ data: { name, slug } });

  const inherited = await rawPrisma.configValue.findMany({
    where: { tenantId: DEFAULT_TENANT_ID, key: { in: INHERITED_SETTINGS } },
  });
  if (inherited.length) {
    await rawPrisma.configValue.createMany({
      data: inherited.map((row) => ({ tenantId: tenant.id, key: row.key, value: row.value })),
    });
  }
  await loadSiteConfig(tenant.id);

  const created = await rawPrisma.tenant.findUnique({
    where: { id: tenant.id },
    include: { _count: { select: { stations: true, admins: true } } },
  });
  res.status(201).json(siteView(created));
});

adminSitesRouter.patch('/:id', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 80) return res.status(400).json({ error: 'name is required (80 characters at most)' });
  const existing = await rawPrisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Site not found' });
  // The address (slug) is not changed after creation, because links depend on it.
  const updated = await rawPrisma.tenant.update({ where: { id: existing.id }, data: { name } });
  res.json({ id: updated.id, slug: updated.slug, name: updated.name });
});

// Creates an administrator for a site. The person must change the passphrase on first sign-in.
adminSitesRouter.post('/:id/admins', async (req, res) => {
  const { email, password } = req.body ?? {};
  const site = await rawPrisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'The starting passphrase must be at least 8 characters' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const admin = await runWithTenant(site.id, () =>
      prisma.admin.create({
        data: {
          email: email.trim().toLowerCase(),
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: true,
        },
      }),
    );
    res.status(201).json({ id: admin.id, email: admin.email, role: admin.role });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }
});

// A site can be deleted only when it has nothing in it. The default site never can be.
adminSitesRouter.delete('/:id', async (req, res) => {
  const site = await rawPrisma.tenant.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { stations: true, admins: true, charges: true, queueEntries: true } } },
  });
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.id === DEFAULT_TENANT_ID) return res.status(400).json({ error: 'The first site cannot be deleted' });

  const { stations, admins, charges, queueEntries } = site._count;
  if (stations || admins || charges || queueEntries) {
    return res.status(400).json({
      error: 'Remove this site\'s charge points, administrators, and waitlist and payment history before deleting it',
    });
  }

  await rawPrisma.$transaction([
    rawPrisma.configValue.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.settings.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.paymentSettings.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.samlConfig.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.customRole.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.ocpiOutbox.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.ocpiToken.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.ocpiPartner.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.zone.deleteMany({ where: { tenantId: site.id } }),
    // Site-only alerts and price changes go with the site. Network-wide ones have no site and stay.
    rawPrisma.alert.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.priceRule.deleteMany({ where: { tenantId: site.id } }),
    rawPrisma.tenant.delete({ where: { id: site.id } }),
  ]);
  await loadAllSites();
  res.status(204).end();
});
