import { resolvePermissions } from '../services/roleService.js';
import { signSessionToken } from './sessionToken.js';

// Body returned whenever a full session is granted. The client uses mustChangePassword to send
// the admin to the forced passphrase change.
export async function sessionBody(admin) {
  return {
    token: signSessionToken(admin),
    email: admin.email,
    role: admin.role,
    permissions: await resolvePermissions(admin.role),
    mustChangePassword: admin.mustChangePassword,
    instanceAdmin: admin.instanceAdmin,
  };
}
