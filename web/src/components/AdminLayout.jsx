import { useEffect, useState } from 'react';
import { Container, Tabs, Tab, Stack, TextField, MenuItem, Typography } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

// Each tab shows when the signed-in role holds its permission. Sites are only
// for the installation administrator.
const TABS = [
  { label: 'Charge points', path: '/admin', end: true, permission: 'stations.view' },
  { label: 'Zones', path: '/admin/zones', permission: 'zones.view' },
  { label: 'Complaints', path: '/admin/complaints', permission: 'complaints.view' },
  { label: 'Payments', path: '/admin/payments', permission: 'payments.view' },
  { label: 'Branding', path: '/admin/branding', permission: 'branding.manage' },
  { label: 'Users', path: '/admin/users', permission: 'users.manage' },
  { label: 'Single sign-on', path: '/admin/sso', permission: 'sso.manage' },
  { label: 'Integrations', path: '/admin/integrations', permission: 'integrations.manage' },
  { label: 'Roaming', path: '/admin/roaming', permission: 'roaming.manage' },
  { label: 'Privacy', path: '/admin/privacy', permission: 'privacy.manage' },
  { label: 'System', path: '/admin/system', permission: 'system.manage' },
  { label: 'Sites', path: '/admin/sites', permission: 'sites.manage', instanceOnly: true },
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

  const visibleTabs = TABS.filter((tab) => can(tab.permission) && (!tab.instanceOnly || isInstanceAdmin));
  const currentTab =
    visibleTabs.find((tab) => (tab.end ? location.pathname === tab.path : location.pathname.startsWith(tab.path)))
      ?.path ?? false;

  return (
    <>
      <Container maxWidth="lg" sx={{ pt: 2 }}>
        <SiteSwitcher />
        <Tabs
          value={currentTab}
          onChange={(_, path) => navigate(path)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {visibleTabs.map((tab) => (
            <Tab key={tab.path} label={tab.label} value={tab.path} />
          ))}
        </Tabs>
      </Container>
      <Outlet />
    </>
  );
}
