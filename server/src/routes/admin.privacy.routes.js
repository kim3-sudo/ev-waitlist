import { Router } from 'express';
import { prisma, rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';

// Mounted behind privacy.manage. Retention periods for this site, and early
// erasure of one driver's personal data.
export const adminPrivacyRouter = Router();

const MAX_DAYS = 3650;

function retentionView(tenant) {
  return {
    queueRetentionDays: tenant.queueRetentionDays,
    // null means financial records are kept indefinitely.
    financialRetentionDays: tenant.financialRetentionDays,
  };
}

async function currentTenant() {
  return rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } });
}

function isWholeDays(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DAYS;
}

adminPrivacyRouter.get('/retention', async (req, res) => {
  const tenant = await currentTenant();
  res.json(retentionView(tenant));
});

adminPrivacyRouter.put('/retention', async (req, res) => {
  const { queueRetentionDays, financialRetentionDays } = req.body ?? {};
  const data = {};

  if (queueRetentionDays !== undefined) {
    if (!isWholeDays(queueRetentionDays)) {
      return res.status(400).json({ error: `queueRetentionDays must be a whole number of days from 1 to ${MAX_DAYS}` });
    }
    data.queueRetentionDays = queueRetentionDays;
  }
  if (financialRetentionDays !== undefined) {
    if (financialRetentionDays !== null && !isWholeDays(financialRetentionDays)) {
      return res.status(400).json({
        error: `financialRetentionDays must be a whole number of days from 1 to ${MAX_DAYS}, or null to keep records indefinitely`,
      });
    }
    data.financialRetentionDays = financialRetentionDays;
  }

  const tenant = await rawPrisma.tenant.update({ where: { id: currentTenantId() }, data });
  res.json(retentionView(tenant));
});

// Clears one driver's personal details now, whatever the retention periods say:
// the queue entry, its complaint notes, and the payer details on their charges.
adminPrivacyRouter.post('/erase', async (req, res) => {
  const { queueEntryId } = req.body ?? {};
  if (!queueEntryId) return res.status(400).json({ error: 'queueEntryId is required' });

  const entry = await prisma.queueEntry.findUnique({ where: { id: queueEntryId } });
  if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });

  const [complaints, charges, holds] = await prisma.$transaction([
    prisma.lineCuttingComplaint.updateMany({
      where: { queueEntryId: entry.id, note: { not: null } },
      data: { note: null },
    }),
    // idTag is generated per queue entry, so it identifies this driver's charges
    // even after the sweep has already cleared the entry's contact.
    prisma.charge.updateMany({
      where: { idTag: entry.idTag },
      data: { payerName: null, payerContact: null },
    }),
    prisma.paymentHold.updateMany({
      where: { idTag: entry.idTag },
      data: { payerName: null, payerContact: null },
    }),
    prisma.queueEntry.update({
      where: { id: entry.id },
      data: { name: '', contact: '', licensePlate: null, parkingPermit: null },
    }),
  ]);

  res.json({ erased: true, complaintNotesCleared: complaints.count, chargesCleared: charges.count, holdsCleared: holds.count });
});
