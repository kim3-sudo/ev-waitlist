import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import {
  ROAMING_TERMS_VERSION,
  ROAMING_WARNING_CORE,
  ROAMING_WARNING_EXTRA_MAX,
  roamingWarningText,
  currentRoaming,
} from '../services/roaming.js';

// Mounted behind roaming.manage. Roaming is off until the administrator has
// acknowledged the current terms, and stays off if the terms change.
export const adminRoamingRouter = Router();

async function state() {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } });
  const roaming = await currentRoaming();
  return {
    enabled: roaming.enabled,
    switchedOn: tenant.roamingEnabled,
    acknowledgedAt: tenant.roamingTermsAcknowledgedAt,
    acknowledgedBy: tenant.roamingTermsAcknowledgedBy,
    acknowledgedVersion: tenant.roamingTermsAcknowledgedVersion,
    currentVersion: ROAMING_TERMS_VERSION,
    needsAcknowledgement: tenant.roamingTermsAcknowledgedVersion !== ROAMING_TERMS_VERSION,
    warningCore: ROAMING_WARNING_CORE,
    warningExtra: tenant.roamingWarningExtra ?? '',
    warningText: roamingWarningText(tenant.roamingWarningExtra ?? ''),
  };
}

adminRoamingRouter.get('/', async (req, res) => {
  res.json(await state());
});

adminRoamingRouter.put('/', async (req, res) => {
  const { enabled, acknowledge, warningExtra } = req.body ?? {};
  const tenantId = currentTenantId();
  const current = await rawPrisma.tenant.findUnique({ where: { id: tenantId } });
  const data = {};

  // Changing the warning text means the old acknowledgement no longer covers it.
  let textChanged = false;
  if (warningExtra !== undefined) {
    const text = typeof warningExtra === 'string' ? warningExtra.trim() : '';
    if (text.length > ROAMING_WARNING_EXTRA_MAX) {
      return res.status(400).json({ error: `The extra warning text can be at most ${ROAMING_WARNING_EXTRA_MAX} characters` });
    }
    textChanged = (current.roamingWarningExtra ?? '') !== text;
    data.roamingWarningExtra = text || null;
    if (textChanged) {
      data.roamingEnabled = false;
      data.roamingTermsAcknowledgedAt = null;
      data.roamingTermsAcknowledgedBy = null;
      data.roamingTermsAcknowledgedVersion = null;
    }
  }

  if (acknowledge === true) {
    data.roamingTermsAcknowledgedAt = new Date();
    data.roamingTermsAcknowledgedBy = req.admin.sub;
    data.roamingTermsAcknowledgedVersion = ROAMING_TERMS_VERSION;
  }

  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    if (enabled) {
      // Roaming can't be turned on until the current terms (and the current
      // text) are acknowledged. The acknowledgement may come in the same request.
      const acknowledgedNow = acknowledge === true;
      const acknowledgedBefore = !textChanged && current.roamingTermsAcknowledgedVersion === ROAMING_TERMS_VERSION;
      if (!acknowledgedNow && !acknowledgedBefore) {
        return res.status(409).json({
          error: 'Read the roaming terms and tick the acknowledgement before turning roaming on',
          code: 'ROAMING_TERMS_NOT_ACKNOWLEDGED',
        });
      }
    }
    data.roamingEnabled = enabled;
  }

  if (Object.keys(data).length) {
    await rawPrisma.tenant.update({ where: { id: tenantId }, data });
  }
  res.json(await state());
});
