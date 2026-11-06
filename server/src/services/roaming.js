import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';

// The roaming terms an administrator acknowledges. Bump this when the required
// text changes: every site must acknowledge the new version before roaming can
// be on again.
export const ROAMING_TERMS_VERSION = '2026-11-05.draft-1';

// Required text, shown to every driver on a site with roaming enabled. A site
// adds its own text after this, but cannot remove it. The wording is a draft
// that the adopter's counsel must review before roaming is enabled.
export const ROAMING_WARNING_CORE = [
  'This session is billed through your own e-mobility provider, not by this charging site.',
  'Joining this waitlist does not change how that provider bills you.',
  'The site operator may remove a roaming entry from the waitlist at any time.',
].join(' ');

export const ROAMING_WARNING_EXTRA_MAX = 1000;

export function roamingWarningText(extra) {
  return extra ? `${ROAMING_WARNING_CORE}\n\n${extra}` : ROAMING_WARNING_CORE;
}

// The current site's roaming state. Roaming counts as on only when the site has
// turned it on and acknowledged the current terms.
export async function currentRoaming() {
  const tenant = await rawPrisma.tenant.findUnique({
    where: { id: currentTenantId() },
    select: {
      roamingEnabled: true,
      roamingTermsAcknowledgedAt: true,
      roamingTermsAcknowledgedVersion: true,
      roamingWarningExtra: true,
    },
  });
  const acknowledged = Boolean(tenant?.roamingTermsAcknowledgedAt) && tenant?.roamingTermsAcknowledgedVersion === ROAMING_TERMS_VERSION;
  return {
    enabled: Boolean(tenant?.roamingEnabled) && acknowledged,
    warningText: roamingWarningText(tenant?.roamingWarningExtra ?? ''),
  };
}

// Joins from a site with roaming on must confirm they read the warning. Returns
// an error object for the response, or null when the join may go ahead.
export async function roamingWarningError(body) {
  const roaming = await currentRoaming();
  if (!roaming.enabled) return null;
  if (body?.roamingWarningAccepted === true) return null;
  return { status: 400, body: { error: 'Please read and accept the roaming warning before joining', code: 'ROAMING_WARNING_REQUIRED' } };
}
