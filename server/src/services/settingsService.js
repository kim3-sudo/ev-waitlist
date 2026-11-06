import { prisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';

export const IDENTIFIER_MODES = ['LICENSE_PLATE', 'PARKING_PERMIT', 'BOTH'];

// One settings row per site. The scoped client fills in the site.
export async function getSettings() {
  const tenantId = currentTenantId();
  const existing = await prisma.settings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.settings.create({ data: { tenantId } });
}

export async function updateSettings(data) {
  const { companyName, logoUrl, primaryColor, secondaryColor, fontFamily, identifierMode, mfaRequired, setupCompleted } =
    data;

  if (identifierMode && !IDENTIFIER_MODES.includes(identifierMode)) {
    throw new Error(`identifierMode must be one of ${IDENTIFIER_MODES.join(', ')}`);
  }

  const tenantId = currentTenantId();
  return prisma.settings.upsert({
    where: { tenantId },
    create: {
      tenantId,
      companyName,
      logoUrl,
      primaryColor,
      secondaryColor,
      fontFamily,
      identifierMode,
      mfaRequired,
      setupCompleted,
    },
    update: {
      companyName,
      logoUrl,
      primaryColor,
      secondaryColor,
      fontFamily,
      identifierMode,
      mfaRequired,
      setupCompleted,
    },
  });
}

// Validates the identifier(s) submitted alongside a waitlist join against
// the configured identifierMode. Returns an error string, or null if valid.
export function validateIdentifiers(identifierMode, { licensePlate, parkingPermit }) {
  const hasPlate = Boolean(licensePlate && licensePlate.trim());
  const hasPermit = Boolean(parkingPermit && parkingPermit.trim());

  if (identifierMode === 'LICENSE_PLATE' && !hasPlate) {
    return 'licensePlate is required';
  }
  if (identifierMode === 'PARKING_PERMIT' && !hasPermit) {
    return 'parkingPermit is required';
  }
  if (identifierMode === 'BOTH' && !hasPlate && !hasPermit) {
    return 'licensePlate or parkingPermit is required';
  }
  return null;
}
