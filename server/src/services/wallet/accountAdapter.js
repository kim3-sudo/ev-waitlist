// The only file in the wallet feature that imports from the driver-account code. If that code
// changes its names, only this file needs to follow.
export { signedInDriver, isDriverAccount } from '../driverAccounts.js';
export { DRIVER_PERMISSION, DRIVER_ROLE } from '../../auth/permissions.js';
