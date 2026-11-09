import { prisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { normalizeHelpContacts, parseHelpContacts } from './helpContacts.js';
import {
  effectivePlateRegions,
  isOfferedRegion,
  parsePlateRegionConfig,
  plateRegionCatalog,
  plateRegionSetList,
  validatePlateRegionConfig,
} from './plateRegions.js';

export const IDENTIFIER_MODES = ['LICENSE_PLATE', 'PARKING_PERMIT', 'BOTH'];

// A font family name goes into a Google Fonts URL and a CSS font-family value, so
// it is limited to letters, digits and spaces, with an optional generic fallback.
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ]{1,60}(, (sans-serif|serif|monospace))?$/;

// One settings row per site. The scoped client fills in the site.
export async function getSettings() {
  const tenantId = currentTenantId();
  const existing = await prisma.settings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.settings.create({ data: { tenantId } });
}

// The settings as the apps read them: the stored row, plus the plate regions the
// join form offers (the effective list), the admin's configuration, and the
// built-in sets the admin can choose from.
export function settingsView(settings) {
  const config = parsePlateRegionConfig(settings.plateRegions);
  return {
    ...settings,
    plateRegions: effectivePlateRegions(config),
    plateRegionConfig: config,
    plateRegionSets: plateRegionSetList(),
    plateRegionCatalog: plateRegionCatalog(),
    defaultPlateRegion: settings.defaultPlateRegion ?? null,
    helpContacts: parseHelpContacts(settings.helpContacts),
  };
}

export async function updateSettings(data) {
  const {
    companyName,
    logoUrl,
    primaryColor,
    secondaryColor,
    fontFamily,
    identifierMode,
    mfaRequired,
    setupCompleted,
    plateRegionConfig,
    defaultPlateRegion,
    helpContacts,
  } = data;

  if (identifierMode && !IDENTIFIER_MODES.includes(identifierMode)) {
    throw new Error(`identifierMode must be one of ${IDENTIFIER_MODES.join(', ')}`);
  }
  if (fontFamily && !FONT_FAMILY_PATTERN.test(fontFamily)) {
    throw new Error('Choose a font family name (letters, digits and spaces only)');
  }

  const tenantId = currentTenantId();
  const current = await getSettings();

  let plateRegions;
  let config = parsePlateRegionConfig(current.plateRegions);
  if (plateRegionConfig !== undefined) {
    const checked = validatePlateRegionConfig(plateRegionConfig);
    if (checked.error) throw new Error(checked.error);
    config = checked.config;
    plateRegions = JSON.stringify(config);
  }

  // The default region must be one the form offers. Blank clears it. If the admin
  // removes the default's region from the list, the default is cleared too.
  let defaultRegion;
  if (defaultPlateRegion !== undefined) {
    if (!defaultPlateRegion) {
      defaultRegion = null;
    } else {
      if (!isOfferedRegion(config, defaultPlateRegion)) {
        throw new Error(`Default plate region ${defaultPlateRegion} is not in the list the form offers`);
      }
      defaultRegion = defaultPlateRegion;
    }
  } else if (plateRegionConfig !== undefined && current.defaultPlateRegion) {
    if (!isOfferedRegion(config, current.defaultPlateRegion)) defaultRegion = null;
  }

  let helpJson;
  if (helpContacts !== undefined) {
    const checked = normalizeHelpContacts(helpContacts);
    if (checked.error) throw new Error(checked.error);
    helpJson = JSON.stringify(checked.value);
  }

  const shared = {
    companyName,
    logoUrl,
    primaryColor,
    secondaryColor,
    fontFamily,
    identifierMode,
    mfaRequired,
    setupCompleted,
    plateRegions,
    defaultPlateRegion: defaultRegion,
    helpContacts: helpJson,
  };
  return prisma.settings.upsert({
    where: { tenantId },
    create: { tenantId, ...shared },
    update: shared,
  });
}

// The plate region to store with a join. A region the form does not offer is an error.
// If the driver gave a plate but no region, the default region is used (or none).
export async function resolvePlateRegion(requested, hasPlate) {
  if (!hasPlate) return { plateRegion: null };
  const settings = await getSettings();
  const config = parsePlateRegionConfig(settings.plateRegions);
  const code = requested || settings.defaultPlateRegion || null;
  if (code && !isOfferedRegion(config, code)) {
    return { error: 'plateRegion is not one of the regions this waitlist offers' };
  }
  return { plateRegion: code };
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
