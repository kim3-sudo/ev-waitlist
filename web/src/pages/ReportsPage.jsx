import { Container, Tabs, Tab, Typography } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { label: 'Idle after charging', path: '/reports/idle' },
  { label: 'Complaints summary', path: '/reports/complaints' },
];

// Aggregate reports. Each tab is its own page under /reports.
export function ReportsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = TABS.find((tab) => location.pathname.startsWith(tab.path))?.path ?? false;

  return (
    <>
      <Container maxWidth="lg" sx={{ pt: 4 }}>
        <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
          Reports
        </Typography>
        <Tabs value={currentTab} onChange={(_, path) => navigate(path)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {TABS.map((tab) => (
            <Tab key={tab.path} label={tab.label} value={tab.path} />
          ))}
        </Tabs>
      </Container>
      <Outlet />
    </>
  );
}
