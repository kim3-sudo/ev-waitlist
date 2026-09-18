import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import { NavBar } from './components/NavBar.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { AdminLayout } from './components/AdminLayout.jsx';
import { PublicWaitlistPage } from './pages/PublicWaitlistPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SsoCallbackPage } from './pages/SsoCallbackPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { AdminStationsPage } from './pages/AdminStationsPage.jsx';
import { AdminZonesPage } from './pages/AdminZonesPage.jsx';
import { AdminSettingsPage } from './pages/AdminSettingsPage.jsx';
import { AdminReportsPage } from './pages/AdminReportsPage.jsx';
import { AdminUsersPage } from './pages/AdminUsersPage.jsx';
import { AdminSsoPage } from './pages/AdminSsoPage.jsx';

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <NavBar />
      <Routes>
        <Route path="/" element={<PublicWaitlistPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso/callback" element={<SsoCallbackPage />} />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminStationsPage />} />
          <Route path="zones" element={<AdminZonesPage />} />
          <Route path="reports" element={<AdminReportsPage />} />
          <Route path="branding" element={<AdminSettingsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="sso" element={<AdminSsoPage />} />
        </Route>
      </Routes>
    </Box>
  );
}
