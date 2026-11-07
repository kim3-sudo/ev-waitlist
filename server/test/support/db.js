import { rawPrisma as prisma, ensureDefaultTenant } from '../../src/db.js';
import { loadAllSites } from '../../src/services/runtimeConfig.js';
import { DEFAULT_TENANT_ID } from '../../src/tenancy/context.js';
import { clearAuditSettingsCache } from '../../src/audit/settings.js';

// Wipes all app tables between tests, for every site. Uses the unscoped client
// so it also clears rows belonging to sites other than the default one.
// Children first so this works regardless of whether SQLite FK cascades are active.
export async function resetDb() {
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.auditSettings.deleteMany(),
    prisma.apiKey.deleteMany(),
    prisma.serviceAccount.deleteMany(),
    prisma.ocpiOutbox.deleteMany(),
    prisma.ocpiToken.deleteMany(),
    prisma.ocpiPartner.deleteMany(),
    prisma.charge.deleteMany(),
    prisma.priceRule.deleteMany(),
    prisma.providerOutage.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.paymentHold.deleteMany(),
    prisma.idleEvent.deleteMany(),
    prisma.meterSample.deleteMany(),
    prisma.stationEvent.deleteMany(),
    prisma.lineCuttingComplaint.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.queueEntry.deleteMany(),
    prisma.connector.deleteMany(),
    prisma.station.deleteMany(),
    prisma.zone.deleteMany(),
    prisma.admin.deleteMany(),
    prisma.settings.deleteMany(),
    prisma.samlConfig.deleteMany(),
    prisma.customRole.deleteMany(),
    prisma.paymentSettings.deleteMany(),
    prisma.configValue.deleteMany(),
    prisma.messageTemplate.deleteMany(),
  ]);
  // Remove any extra sites, then make sure the default site exists again.
  await prisma.tenant.deleteMany({ where: { id: { not: DEFAULT_TENANT_ID } } });
  await ensureDefaultTenant();
  // The default site and operator keep their rows, so restore their defaults.
  await prisma.tenant.update({
    where: { id: DEFAULT_TENANT_ID },
    data: {
      queueRetentionDays: 30,
      financialRetentionDays: 30,
      roamingEnabled: false,
      roamingTermsAcknowledgedAt: null,
      roamingTermsAcknowledgedBy: null,
      roamingTermsAcknowledgedVersion: null,
      roamingWarningExtra: null,
    },
  });
  await prisma.operator.update({ where: { id: 'singleton' }, data: { name: '', countryCode: '', partyId: '' } });
  clearAuditSettingsCache();
  // Site settings are cached in memory, so reload them from the (now empty) rows.
  await loadAllSites();
}
