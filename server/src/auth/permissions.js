// The permission catalog. Every admin route checks one of these keys.
// Keys are stored in CustomRole.permissions, so renaming one is a data migration.
export const PERMISSIONS = [
  { key: 'stations.view', group: 'Charge points', label: 'View charge points' },
  { key: 'stations.manage', group: 'Charge points', label: 'Add, edit, and remove charge points' },
  { key: 'zones.view', group: 'Zones', label: 'View zones' },
  { key: 'zones.manage', group: 'Zones', label: 'Create, edit, and delete zones' },
  { key: 'complaints.view', group: 'Complaints', label: 'View line-cutting complaints' },
  { key: 'complaints.manage', group: 'Complaints', label: 'Resolve or dismiss complaints' },
  { key: 'reports.view', group: 'Reports', label: 'View reports' },
  { key: 'payments.view', group: 'Payments', label: 'View pricing and charges' },
  { key: 'payments.manage', group: 'Payments', label: 'Change pricing and payment providers' },
  { key: 'branding.manage', group: 'Settings', label: 'Change branding, identifiers, and MFA policy' },
  { key: 'sso.manage', group: 'Settings', label: 'Configure single sign-on' },
  { key: 'system.manage', group: 'Settings', label: 'Change web addresses, CORS origin, and reservation window' },
  { key: 'integrations.manage', group: 'Settings', label: 'Change payment provider keys and test connections' },
  { key: 'users.manage', group: 'Users', label: 'Manage users and roles' },
  { key: 'privacy.manage', group: 'Privacy', label: 'Set retention periods and erase a driver\'s personal data' },
  { key: 'roaming.manage', group: 'Roaming', label: 'Turn roaming on or off and edit its warning' },
  // Also needs the installation administrator flag (see requireInstanceAdmin).
  { key: 'sites.manage', group: 'Sites', label: 'Create and manage sites and the operator (installation administrator only)' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Built-in roles live in code so they can't be edited or deleted by mistake.
export const BUILT_IN_ROLES = {
  ADMIN: {
    description: 'Full access to everything.',
    permissions: PERMISSION_KEYS,
  },
  VIEWER: {
    description: 'Read-only access to charge points, zones, complaints, and reports.',
    permissions: ['stations.view', 'zones.view', 'complaints.view', 'reports.view'],
  },
};

export const BUILT_IN_ROLE_NAMES = Object.keys(BUILT_IN_ROLES);
