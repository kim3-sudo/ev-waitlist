// The permission catalog. Every admin route checks one of these keys.
// Keys are stored in CustomRole.permissions, so renaming one is a data migration.
export const PERMISSIONS = [
  { key: 'stations.view', group: 'Charge points', label: 'View charge points' },
  { key: 'stations.manage', group: 'Charge points', label: 'Add, edit, and remove charge points' },
  { key: 'stations.control', group: 'Charge points', label: 'Send commands to charge points (stop sessions, unlock, reset, holds)' },
  { key: 'zones.view', group: 'Zones', label: 'View zones' },
  { key: 'zones.manage', group: 'Zones', label: 'Create, edit, and delete zones' },
  { key: 'alerts.manage', group: 'Charge points', label: 'Post and remove alerts for drivers (by charge point, location, or site)' },
  { key: 'complaints.view', group: 'Complaints', label: 'View line-cutting complaints' },
  { key: 'complaints.manage', group: 'Complaints', label: 'Resolve or dismiss complaints' },
  { key: 'reports.view', group: 'Reports', label: 'View reports' },
  { key: 'payments.view', group: 'Payments', label: 'View pricing and charges' },
  { key: 'payments.manage', group: 'Payments', label: 'Change pricing, surge pricing and complimentary charging, and payment providers' },
  { key: 'branding.manage', group: 'Settings', label: 'Change branding, identifiers, and MFA policy' },
  { key: 'sso.manage', group: 'Settings', label: 'Configure single sign-on' },
  { key: 'system.manage', group: 'Settings', label: 'Change web addresses, CORS origin, and reservation window' },
  { key: 'integrations.manage', group: 'Settings', label: 'Change payment provider keys and test connections' },
  { key: 'users.manage', group: 'Users', label: 'Manage users and roles' },
  { key: 'privacy.manage', group: 'Privacy', label: 'Set retention periods and erase a driver\'s personal data' },
  { key: 'roaming.manage', group: 'Roaming', label: 'Turn roaming on or off and edit its warning' },
  // Also needs the installation administrator flag (see requireInstanceAdmin).
  { key: 'sites.manage', group: 'Sites', label: 'Create and manage sites and the operator (installation administrator only)' },
  { key: 'serviceAccounts.view', group: 'API access', label: 'View service accounts, their permissions, and API key details' },
  { key: 'serviceAccounts.manage', group: 'API access', label: 'Create, change, and revoke service accounts and their API keys' },
  { key: 'audit.view', group: 'Audit', label: 'View the audit log and check its tamper-evidence chain' },
  { key: 'audit.export', group: 'Audit', label: 'Download the audit log, and see the SIEM export status' },
  // Driver features: the account's own vehicles and details. Every admin role has it, and the
  // driver role has only it, so a driver account cannot reach the admin pages.
  { key: 'driver.account', group: 'Driver accounts', label: 'Use a driver account: manage own vehicles and details' },

  // Held by service accounts (API keys), not by people. See routes/api.v1.
  { key: 'api.stations.read', group: 'API (service accounts)', label: 'Read charge points and their status' },
  { key: 'api.stations.write', group: 'API (service accounts)', label: 'Add, change, and remove charge points' },
  { key: 'api.stations.control', group: 'API (service accounts)', label: 'Send commands to charge points (stop sessions, unlock, reset, holds)' },
  { key: 'api.zones.read', group: 'API (service accounts)', label: 'Read zones' },
  { key: 'api.zones.write', group: 'API (service accounts)', label: 'Create, change, and delete zones' },
  { key: 'api.waitlist.read', group: 'API (service accounts)', label: 'Read waitlist entries' },
  { key: 'api.waitlist.manage', group: 'API (service accounts)', label: 'Cancel waitlist entries' },
  { key: 'api.charges.read', group: 'API (service accounts)', label: 'Read charges (no payer details)' },
  { key: 'api.priceRules.read', group: 'API (service accounts)', label: 'Read surge pricing and complimentary charging rules' },
  { key: 'api.priceRules.write', group: 'API (service accounts)', label: 'Create, change, and delete surge pricing and complimentary charging rules' },
  { key: 'api.alerts.read', group: 'API (service accounts)', label: 'Read driver alerts' },
  { key: 'api.alerts.write', group: 'API (service accounts)', label: 'Create, change, and delete driver alerts' },
  { key: 'api.complaints.read', group: 'API (service accounts)', label: 'Read line-cutting complaints' },
  { key: 'api.reports.read', group: 'API (service accounts)', label: 'Read reports and energy usage' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// The keys a service account may hold. Everything else is for people only.
export const SERVICE_ACCOUNT_PERMISSION_KEYS = PERMISSION_KEYS.filter((k) => k.startsWith('api.'));

// The permission every driver account holds. An account that holds nothing else is a
// driver account: it can use the driver pages but not the admin ones.
export const DRIVER_PERMISSION = 'driver.account';
export const DRIVER_ROLE = 'DRIVER';

export function isDriverOnly(permissions) {
  return permissions.includes(DRIVER_PERMISSION) && permissions.every((p) => p === DRIVER_PERMISSION);
}

// Built-in roles live in code so they can't be edited or deleted by mistake.
export const BUILT_IN_ROLES = {
  ADMIN: {
    description: 'Full access to everything.',
    permissions: PERMISSION_KEYS,
  },
  // Given to accounts that sign up as drivers. Not offered when giving a person an admin role.
  [DRIVER_ROLE]: {
    description: 'A driver account: manages its own vehicles and details, and nothing else.',
    permissions: [DRIVER_PERMISSION],
    hidden: true,
  },
  VIEWER: {
    description: 'Read-only access to charge points, zones, complaints, and reports.',
    permissions: ['stations.view', 'zones.view', 'complaints.view', 'reports.view'],
  },
  API_DEVELOPER: {
    description: 'Builds and runs integrations: manages service accounts and their API keys, with full API permissions to grant. Read-only everywhere else.',
    permissions: [
      'stations.view',
      'zones.view',
      'complaints.view',
      'reports.view',
      'payments.view',
      'serviceAccounts.view',
      'serviceAccounts.manage',
      ...SERVICE_ACCOUNT_PERMISSION_KEYS,
    ],
  },
};

export const BUILT_IN_ROLE_NAMES = Object.keys(BUILT_IN_ROLES).filter((name) => !BUILT_IN_ROLES[name].hidden);
