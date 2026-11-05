import { Container, Tabs, Tab } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Each tab shows when the signed-in role holds its permission.
const TABS = [
  { label: 'Charge points', path: '/admin', end: true, permission: 'stations.view' },
  { label: 'Zones', path: '/admin/zones', permission: 'zones.view' },
  { label: 'Complaints', path: '/admin/complaints', permission: 'complaints.view' },
  { label: 'Payments', path: '/admin/payments', permission: 'payments.view' },
  { label: 'Branding', path: '/admin/branding', permission: 'branding.manage' },
  { label: 'Users', path: '/admin/users', permission: 'users.manage' },
  { label: 'Single sign-on', path: '/admin/sso', permission: 'sso.manage' },
  { label: 'Integrations', path: '/admin/integrations', permission: 'integrations.manage' },
  { label: 'System', path: '/admin/system', permission: 'system.manage' },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();

  const visibleTabs = TABS.filter((tab) => can(tab.permission));
  const currentTab =
    visibleTabs.find((tab) => (tab.end ? location.pathname === tab.path : location.pathname.startsWith(tab.path)))
      ?.path ?? false;

  return (
    <>
      <Container maxWidth="lg" sx={{ pt: 2 }}>
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
