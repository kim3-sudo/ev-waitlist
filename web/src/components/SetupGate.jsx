import { Navigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Sends full admins to the first-run setup wizard until it has been completed or skipped.
// Viewers can't run the wizard, so they are never sent there.
export function SetupGate({ children }) {
  const { settings, loaded } = useSettings();
  const { role, can } = useAuth();
  if (!loaded || role === null) return null;
  if (can('branding.manage') && !settings.setupCompleted) return <Navigate to="/setup" replace />;
  return children;
}
