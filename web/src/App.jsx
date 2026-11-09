import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { NavBar } from './components/NavBar.jsx';
import { ProtectedRoute, PermissionRoute } from './components/ProtectedRoute.jsx';
import { AdminLayout } from './components/AdminLayout.jsx';
import { PublicWaitlistPage } from './pages/PublicWaitlistPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SsoCallbackPage } from './pages/SsoCallbackPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { AdminStationsPage } from './pages/AdminStationsPage.jsx';
import { AdminZonesPage } from './pages/AdminZonesPage.jsx';
import { AdminBrandingPage } from './pages/AdminBrandingPage.jsx';
import { AdminWaitlistPage } from './pages/AdminWaitlistPage.jsx';
import { AdminTemplatesPage } from './pages/AdminTemplatesPage.jsx';
import { AdminEmailPage } from './pages/AdminEmailPage.jsx';
import { AdminSmsPage } from './pages/AdminSmsPage.jsx';
import { ReportsPage } from './pages/ReportsPage.jsx';
import { IdleReportPage } from './pages/IdleReportPage.jsx';
import { ComplaintsSummaryPage } from './pages/ComplaintsSummaryPage.jsx';
import { EnergyReportPage } from './pages/EnergyReportPage.jsx';
import { UsageReportPage } from './pages/UsageReportPage.jsx';
import { HelpPage } from './help/HelpPage.jsx';
import { AdminUsersPage } from './pages/AdminUsersPage.jsx';
import { AdminSsoPage } from './pages/AdminSsoPage.jsx';
import { ChangePassphrasePage } from './pages/ChangePassphrasePage.jsx';
import { SetupWizardPage } from './pages/SetupWizardPage.jsx';
import { SetupGate } from './components/SetupGate.jsx';
import { AdminPaymentsPage } from './pages/AdminPaymentsPage.jsx';
import { AdminPriceRulesPage } from './pages/AdminPriceRulesPage.jsx';
import { AdminAlertsPage } from './pages/AdminAlertsPage.jsx';
import { AdminServiceAccountsPage } from './pages/AdminServiceAccountsPage.jsx';
import { AdminAuditPage } from './pages/AdminAuditPage.jsx';
import { AdminIntegrationsPage } from './pages/AdminIntegrationsPage.jsx';
import { AdminSystemPage } from './pages/AdminSystemPage.jsx';
import { PayPage } from './pages/PayPage.jsx';
import { PayHoldPage } from './pages/PayHoldPage.jsx';
import { SiteScope } from './components/SiteScope.jsx';
import { AdminSitesPage } from './pages/AdminSitesPage.jsx';
import { AdminPrivacyPage } from './pages/AdminPrivacyPage.jsx';
import { AdminRoamingPage } from './pages/AdminRoamingPage.jsx';
import { AdminLocationPage } from './pages/AdminLocationPage.jsx';

// The locator loads its map library, so it is split out and loaded only when opened.
const LocatorPage = lazy(() => import('./pages/LocatorPage.jsx').then((m) => ({ default: m.LocatorPage })));

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <NavBar />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<PublicWaitlistPage />} />
        <Route path="/locator" element={<LocatorPage />} />
        <Route
          path="/t/:slug/locator"
          element={
            <SiteScope>
              <LocatorPage />
            </SiteScope>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso/callback" element={<SsoCallbackPage />} />
        <Route path="/pay/hold/:token" element={<PayHoldPage />} />
        <Route path="/pay/:token" element={<PayPage />} />
        <Route
          path="/t/:slug"
          element={
            <SiteScope>
              <PublicWaitlistPage />
            </SiteScope>
          }
        />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute allowPasswordChange>
              <ChangePassphrasePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/setup"
          element={
            <ProtectedRoute>
              <SetupWizardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <ReportsPage />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="idle" replace />} />
          <Route path="idle" element={<IdleReportPage />} />
          <Route path="complaints" element={<ComplaintsSummaryPage />} />
          <Route path="usage" element={<UsageReportPage />} />
          <Route path="energy" element={<EnergyReportPage />} />
        </Route>
        <Route
          path="/help"
          element={
            <ProtectedRoute>
              <HelpPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/help/:articleId"
          element={
            <ProtectedRoute>
              <HelpPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <SetupGate>
                <AdminLayout />
              </SetupGate>
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminStationsPage />} />
          <Route path="zones" element={<AdminZonesPage />} />
          <Route
            path="location"
            element={
              <PermissionRoute permission="stations.manage">
                <AdminLocationPage />
              </PermissionRoute>
            }
          />
          <Route path="complaints" element={<Navigate to="/reports/complaints" replace />} />
          <Route path="reports" element={<Navigate to="/reports/idle" replace />} />
          <Route
            path="payments"
            element={
              <PermissionRoute permission="payments.view">
                <AdminPaymentsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="price-changes"
            element={
              <PermissionRoute permission="payments.view">
                <AdminPriceRulesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="alerts"
            element={
              <PermissionRoute permission="alerts.manage">
                <AdminAlertsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="audit"
            element={
              <PermissionRoute permission="audit.view">
                <AdminAuditPage />
              </PermissionRoute>
            }
          />
          <Route
            path="api-access"
            element={
              <PermissionRoute permission="serviceAccounts.view">
                <AdminServiceAccountsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="branding"
            element={
              <PermissionRoute permission="branding.manage">
                <AdminBrandingPage />
              </PermissionRoute>
            }
          />
          <Route
            path="waitlist"
            element={
              <PermissionRoute permission="branding.manage">
                <AdminWaitlistPage />
              </PermissionRoute>
            }
          />
          <Route
            path="templates"
            element={
              <PermissionRoute permission="branding.manage">
                <AdminTemplatesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="email"
            element={
              <PermissionRoute permission="integrations.manage">
                <AdminEmailPage />
              </PermissionRoute>
            }
          />
          <Route
            path="sms"
            element={
              <PermissionRoute permission="integrations.manage">
                <AdminSmsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="users"
            element={
              <PermissionRoute permission="users.manage">
                <AdminUsersPage />
              </PermissionRoute>
            }
          />
          <Route
            path="sso"
            element={
              <PermissionRoute permission="sso.manage">
                <AdminSsoPage />
              </PermissionRoute>
            }
          />
          <Route
            path="integrations"
            element={
              <PermissionRoute permission="integrations.manage">
                <AdminIntegrationsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="system"
            element={
              <PermissionRoute permission="system.manage">
                <AdminSystemPage />
              </PermissionRoute>
            }
          />
          <Route
            path="roaming"
            element={
              <PermissionRoute permission="roaming.manage">
                <AdminRoamingPage />
              </PermissionRoute>
            }
          />
          <Route
            path="privacy"
            element={
              <PermissionRoute permission="privacy.manage">
                <AdminPrivacyPage />
              </PermissionRoute>
            }
          />
          <Route
            path="sites"
            element={
              <PermissionRoute permission="sites.manage">
                <AdminSitesPage />
              </PermissionRoute>
            }
          />
        </Route>
      </Routes>
      </Suspense>
    </Box>
  );
}
