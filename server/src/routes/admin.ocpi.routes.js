import { Router } from 'express';
import { prisma, rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { currentRoaming } from '../services/roaming.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { newToken, hashToken } from '../ocpi/tokens.js';
import { dispatchDue } from '../ocpi/outbox.js';

// Mounted behind roaming.manage. Roaming partners for this site: invite them,
// revoke or remove them, and see what is waiting to be sent.
export const adminOcpiRouter = Router();

function partnerView(p) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    partyId: p.theirPartyId ? `${p.theirCountryCode}*${p.theirPartyId}` : null,
    endpoints: Object.keys(JSON.parse(p.endpoints || '{}')),
    lastError: p.lastError,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

adminOcpiRouter.get('/partners', async (req, res) => {
  const partners = await prisma.ocpiPartner.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(partners.map(partnerView));
});

// Creates a partner invitation. The registration token is shown once, and is given
// to the partner out of band.
adminOcpiRouter.post('/partners', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 120) return res.status(400).json({ error: 'A partner name is required (120 characters at most)' });
  const roaming = await currentRoaming();
  if (!roaming.enabled) {
    return res.status(409).json({ error: 'Turn roaming on for this site before inviting a partner', code: 'ROAMING_NOT_ENABLED' });
  }

  const registrationToken = newToken();
  const partner = await prisma.ocpiPartner.create({
    data: { name, status: 'PENDING', registrationTokenHash: hashToken(registrationToken) },
  });
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() }, select: { slug: true } });
  res.status(201).json({
    ...partnerView(partner),
    registrationToken,
    versionsUrl: `${siteConfig().publicUrl}/ocpi/${tenant.slug}/versions`,
  });
});

// Stops a partner's access. Their queued messages are dropped.
adminOcpiRouter.post('/partners/:id/revoke', async (req, res) => {
  const partner = await prisma.ocpiPartner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  await prisma.ocpiOutbox.updateMany({ where: { partnerId: partner.id, status: 'PENDING' }, data: { status: 'FAILED', lastError: 'Partner revoked' } });
  const updated = await prisma.ocpiPartner.update({
    where: { id: partner.id },
    data: { status: 'REVOKED', ourTokenHash: null, registrationTokenHash: null },
  });
  res.json(partnerView(updated));
});

adminOcpiRouter.delete('/partners/:id', async (req, res) => {
  const partner = await prisma.ocpiPartner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  await prisma.ocpiPartner.delete({ where: { id: partner.id } });
  res.status(204).end();
});

adminOcpiRouter.get('/outbox', async (req, res) => {
  const rows = await prisma.ocpiOutbox.findMany({
    include: { partner: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(
    rows.map((r) => ({
      id: r.id,
      partner: r.partner.name,
      kind: r.kind,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      createdAt: r.createdAt,
    })),
  );
});

// Sends what is due now, without waiting for the timer.
adminOcpiRouter.post('/dispatch', async (req, res) => {
  const sent = await dispatchDue();
  res.json({ sent });
});
