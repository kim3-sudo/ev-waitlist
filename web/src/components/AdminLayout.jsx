import { useEffect, useState } from 'react';
import { Container, Stack, TextField, MenuItem, Typography } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { SectionDrawer } from './SectionDrawer.jsx';

// Admin pages, grouped by what they configure. A section shows when the signed-in role
// holds the permission for at least one of its pages. Sites are only for the
// installation administrator.
const SECTIONS = [
  {
    title: 'Charge points',
    items: [
      { label: 'Charge points', path: '/admin', end: true, permission: 'stations.view' },
      { label: 'Zones', path: '/admin/zones', permission: 'zones.view' },
      { label: 'Alerts', path: '/admin/alerts', permission: 'alerts.manage' },
    ],
  },
  {
    title: 'Payments',
    items: [
      { label: 'Payment settings', path: '/admin/payments', permission: 'payments.view' },
      { label: 'Price changes', path: '/admin/price-changes', permission: 'payments.view' },
      { label: 'Payment providers', path: '/admin/integrations', permission: 'integrations.manage' },
    ],
  },
  {
    title: 'Users & groups',
    items: [
      { label: 'Users and roles', path: '/admin/users', permission: 'users.manage' },
      { label: 'Single sign-on', path: '/admin/sso', permission: 'sso.manage' },
      { label: 'API access', path: '/admin/api-access', permission: 'serviceAccounts.view' },
    ],
  },
  {
    title: 'Branding',
    items: [{ label: 'Branding', path: '/admin/branding', permission: 'branding.manage' }],
  },
  {
    title: 'Waitlist',
    items: [
      { label: 'Waitlist', path: '/admin/waitlist', permission: 'branding.manage' },
      { label: 'Message templates', path: '/admin/templates', permission: 'branding.manage' },
    ],
  },
  {
    title: 'Notification integrations',
    items: [
      { label: 'E-mail server', path: '/admin/email', permission: 'integrations.manage' },
      { label: 'SMS service', path: '/admin/sms', permission: 'integrations.manage' },
    ],
  },
  {
    title: 'Roaming',
    items: [{ label: 'Roaming and partners', path: '/admin/roaming', permission: 'roaming.manage' }],
  },
  {
    title: 'Audit',
    items: [{ label: 'Audit log', path: '/admin/audit', permission: 'audit.view' }],
  },
  {
    title: 'Privacy',
    items: [{ label: 'Retention and erasure', path: '/admin/privacy', permission: 'privacy.manage' }],
  },
  {
    title: 'System',
    items: [
      { label: 'System settings', path: '/admin/system', permission: 'system.manage' },
      { label: 'Sites', path: '/admin/sites', permission: 'sites.manage', instanceOnly: true },
    ],
  },
];

const DEFAULT_SLUG = 'default';

// Lets the installation administrator work on another site. Shown only when the
// installation has more than one site.
function SiteSwitcher() {
  const { isInstanceAdmin } = useAuth();
  const [sites, setSites] = useState([]);
  const current = localStorage.getItem('adminSite') ?? DEFAULT_SLUG;

  useEffect(() => {
    if (!isInstanceAdmin) return;
    api
      .get('/api/admin/sites')
      .then(({ data }) => setSites(data))
      .catch(() => setSites([]));
  }, [isInstanceAdmin]);

  if (!isInstanceAdmin || sites.length < 2) return null;

  function choose(slug) {
    if (slug === DEFAULT_SLUG) localStorage.removeItem('adminSite');
    else localStorage.setItem('adminSite', slug);
    // Every admin page reads its data on load, so reload to show the chosen site.
    window.location.reload();
  }

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', pt: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Site
      </Typography>
      <TextField select size="small" value={current} onChange={(e) => choose(e.target.value)} sx={{ minWidth: 220 }}>
        {sites.map((site) => (
          <MenuItem key={site.slug} value={site.slug}>
            {site.name}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { can, isInstanceAdmin } = useAuth();

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(item.permission) && (!item.instanceOnly || isInstanceAdmin)),
  })).filter((section) => section.items.length > 0);

  const currentPath =
    sections
      .flatMap((section) => section.items)
      .find((item) => (item.end ? location.pathname === item.path : location.pathname.startsWith(item.path)))?.path ??
    '';

  return (
    <SectionDrawer sections={sections} currentPath={currentPath} onNavigate={navigate} label="Admin settings">
      <Container maxWidth="lg" sx={{ pt: 2 }}>
        <SiteSwitcher />
      </Container>
      <Outlet />
    </SectionDrawer>
  );
}
