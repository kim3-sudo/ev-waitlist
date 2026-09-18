import { prisma } from '../db.js';

const SETTINGS_ID = 'singleton';

export const IDENTIFIER_MODES = ['LICENSE_PLATE', 'PARKING_PERMIT', 'BOTH'];

export async function getSettings() {
  const existing = await prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: SETTINGS_ID } });
}

export async function updateSettings(data) {
  const { companyName, logoUrl, primaryColor, secondaryColor, fontFamily, identifierMode, mfaRequired } = data;

  if (identifierMode && !IDENTIFIER_MODES.includes(identifierMode)) {
    throw new Error(`identifierMode must be one of ${IDENTIFIER_MODES.join(', ')}`);
  }

  return prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, companyName, logoUrl, primaryColor, secondaryColor, fontFamily, identifierMode, mfaRequired },
    update: { companyName, logoUrl, primaryColor, secondaryColor, fontFamily, identifierMode, mfaRequired },
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
