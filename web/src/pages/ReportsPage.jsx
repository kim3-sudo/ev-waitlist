import { Container, Typography } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SectionDrawer } from '../components/SectionDrawer.jsx';

// Reports, grouped by what they cover. Each page is its own route under /reports.
const SECTIONS = [
  {
    title: 'Charging',
    items: [
      { label: 'Usage and idle time', path: '/reports/usage' },
      { label: 'Energy dispensed', path: '/reports/energy' },
      { label: 'Idle after charging', path: '/reports/idle' },
    ],
  },
  {
    title: 'Complaints',
    items: [{ label: 'Line-cutting complaints', path: '/reports/complaints' }],
  },
];

export function ReportsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath =
    SECTIONS.flatMap((section) => section.items).find((item) => location.pathname.startsWith(item.path))?.path ?? '';

  return (
    <SectionDrawer sections={SECTIONS} currentPath={currentPath} onNavigate={navigate} label="Reports">
      <Container maxWidth="lg" sx={{ pt: 4 }}>
        <Typography variant="h5" fontWeight={600}>
          Reports
        </Typography>
      </Container>
      <Outlet />
    </SectionDrawer>
  );
}
