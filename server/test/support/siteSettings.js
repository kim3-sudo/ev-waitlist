import { runWithTenant, DEFAULT_TENANT_ID } from '../../src/tenancy/context.js';
import { saveRuntimeSettings } from '../../src/services/runtimeConfig.js';

const ALL_GROUPS = ['system', 'stripe', 'braintree', 'square', 'email', 'sms'];

// Saves per-site settings the same way the admin UI does, so tests exercise the
// real path. Throws if a value is refused.
export async function setSiteSettings(updates, tenantId = DEFAULT_TENANT_ID) {
  const result = await runWithTenant(tenantId, () => saveRuntimeSettings(updates, ALL_GROUPS));
  if (result.error) throw new Error(result.error);
}
