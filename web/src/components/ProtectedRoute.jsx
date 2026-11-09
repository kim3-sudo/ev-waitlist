import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Requires a signed-in account. Anyone still on a first-run passphrase is sent
// to the change-passphrase screen, unless this route is that screen. Signing in is
// one page for everyone, so the default sends people there.
export function ProtectedRoute({ children, allowPasswordChange = false, signInPath = '/login' }) {
  const { isAuthenticated, mustChangePassword } = useAuth();
  if (!isAuthenticated) return <Navigate to={signInPath} replace />;
  if (mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;
  return children;
}

// Shows the page only to roles holding `permission`. Others go back to the charge points tab.
export function PermissionRoute({ permission, children }) {
  const { role, can } = useAuth();
  if (role === null) return null; // role still loading
  if (!can(permission)) return <Navigate to="/admin" replace />;
  return children;
}
