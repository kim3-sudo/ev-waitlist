import { Container, Tabs, Tab } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { label: 'Charge points', path: '/admin', end: true },
  { label: 'Zones', path: '/admin/zones' },
  { label: 'Reports', path: '/admin/reports' },
  { label: 'Branding', path: '/admin/branding' },
  { label: 'Users', path: '/admin/users' },
  { label: 'Single sign-on', path: '/admin/sso' },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const currentTab =
    TABS.find((tab) => (tab.end ? location.pathname === tab.path : location.pathname.startsWith(tab.path)))?.path ??
    false;

  return (
    <>
      <Container maxWidth="lg" sx={{ pt: 2 }}>
        <Tabs
          value={currentTab}
          onChange={(_, path) => navigate(path)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {TABS.map((tab) => (
            <Tab key={tab.path} label={tab.label} value={tab.path} />
          ))}
        </Tabs>
      </Container>
      <Outlet />
    </>
  );
}
