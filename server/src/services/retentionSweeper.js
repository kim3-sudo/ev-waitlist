import { prisma, rawPrisma } from '../db.js';
import { runWithTenant, currentTenantId } from '../tenancy/context.js';
import { revokeStaleCredentials } from './wallet/credentialService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = ['COMPLETED', 'EXPIRED', 'CANCELLED'];
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// Clears personal data that has been kept longer than the site's retention
// periods. Runs in the current site. Safe to repeat: already-cleared rows don't match.
export async function sweepRetention(now = new Date()) {
  const tenant = await rawPrisma.tenant.findUnique({
    where: { id: currentTenantId() },
    select: { queueRetentionDays: true, financialRetentionDays: true },
  });
  if (!tenant) return { queueEntries: 0, complaints: 0, charges: 0 };

  // Queue entries: name, contact, plate and permit go once the entry has been
  // closed for the queue period. The idTag stays, because charges and the OCPP
  // record refer to it.
  const queueCutoff = new Date(now.getTime() - tenant.queueRetentionDays * DAY_MS);
  const queue = await prisma.queueEntry.updateMany({
    where: { status: { in: CLOSED_STATUSES }, closedAt: { lt: queueCutoff }, contact: { not: '' } },
    data: { name: '', contact: '', smsNumber: null, licensePlate: null, plateRegion: null, parkingPermit: null, accountId: null },
  });

  // Wallet passes: a closed entry no longer links to its driver account, and passes that have gone
  // unused for the queue period are revoked (see services/wallet/credentialService.js).
  const walletCredentials = await revokeStaleCredentials(queueCutoff, now);

  // Complaints: the free-text note goes once the complaint has been resolved or
  // dismissed for the queue period.
  const complaints = await prisma.lineCuttingComplaint.updateMany({
    where: { status: { in: ['RESOLVED', 'DISMISSED'] }, resolvedAt: { lt: queueCutoff }, note: { not: null } },
    data: { note: null },
  });

  // Meter readings and station history are operational records, but readings can identify
  // what a driver did when, so they are deleted on the queue period too.
  const readings = await prisma.meterSample.deleteMany({ where: { at: { lt: queueCutoff } } });
  const history = await prisma.stationEvent.deleteMany({ where: { at: { lt: queueCutoff } } });

  // Charges: payer details go after the financial period. Null means keep them.
  let charges = { count: 0 };
  let holds = { count: 0 };
  if (tenant.financialRetentionDays != null) {
    const financialCutoff = new Date(now.getTime() - tenant.financialRetentionDays * DAY_MS);
    charges = await prisma.charge.updateMany({
      where: {
        createdAt: { lt: financialCutoff },
        OR: [{ payerName: { not: null } }, { payerContact: { not: null } }, { payerSmsNumber: { not: null } }],
      },
      data: { payerName: null, payerContact: null, payerSmsNumber: null },
    });
    // Card holds are financial records too, so their payer details follow the same period.
    holds = await prisma.paymentHold.updateMany({
      where: {
        createdAt: { lt: financialCutoff },
        OR: [{ payerName: { not: null } }, { payerContact: { not: null } }],
      },
      data: { payerName: null, payerContact: null },
    });
  }

  return {
    queueEntries: queue.count,
    walletCredentials,
    complaints: complaints.count,
    charges: charges.count,
    holds: holds.count,
    meterSamples: readings.count,
    stationEvents: history.count,
  };
}

// Runs the retention sweep for every site.
export async function sweepRetentionAllTenants() {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    await runWithTenant(tenant.id, () => sweepRetention()).catch((err) =>
      console.error(`Retention sweep failed for site ${tenant.id}:`, err),
    );
  }
}

export function startRetentionSweeper() {
  sweepRetentionAllTenants().catch((err) => console.error('Retention sweep failed:', err));
  return setInterval(() => {
    sweepRetentionAllTenants().catch((err) => console.error('Retention sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
}
