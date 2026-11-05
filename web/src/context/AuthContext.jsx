import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

function readStoredPermissions() {
  try {
    const value = JSON.parse(localStorage.getItem('adminPermissions') ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storePermissions(permissions) {
  try {
    localStorage.setItem('adminPermissions', JSON.stringify(permissions));
  } catch {
    // Storage can be blocked; the context still works for this page load.
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('adminToken'));
  const [email, setEmail] = useState(() => localStorage.getItem('adminEmail'));
  const [mustChangePassword, setMustChangePassword] = useState(
    () => localStorage.getItem('adminMustChangePassword') === 'true',
  );
  // Role name ('ADMIN', 'VIEWER', or a custom role). Null until known.
  const [role, setRole] = useState(() => localStorage.getItem('adminRole'));
  // Permission keys granted by the role. The server is the real check; this only hides controls.
  const [permissions, setPermissions] = useState(() => readStoredPermissions());

  // Re-read the role on each sign-in so a change made by another admin applies on the next load.
  useEffect(() => {
    if (!token) return;
    api
      .get('/api/auth/me')
      .then(({ data }) => {
        storePermissions(data.permissions ?? []);
        localStorage.setItem('adminRole', data.role);
        setRole(data.role);
        setPermissions(data.permissions ?? []);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const onRequired = () => setMustChangePassword(true);
    window.addEventListener('auth:password-change-required', onRequired);
    return () => window.removeEventListener('auth:password-change-required', onRequired);
  }, []);

  const value = useMemo(() => {
    function setSession(newToken, newEmail, newMustChangePassword = false, newRole = null, newPermissions = null) {
      localStorage.setItem('adminToken', newToken);
      localStorage.setItem('adminEmail', newEmail);
      localStorage.setItem('adminMustChangePassword', String(newMustChangePassword));
      if (newRole) localStorage.setItem('adminRole', newRole);
      if (newPermissions) storePermissions(newPermissions);
      setToken(newToken);
      setEmail(newEmail);
      setMustChangePassword(newMustChangePassword);
      if (newRole) setRole(newRole);
      if (newPermissions) setPermissions(newPermissions);
    }

    return {
      token,
      email,
      role,
      permissions,
      can: (permission) => permissions.includes(permission),
      mustChangePassword,
      isAuthenticated: Boolean(token),
      async login(loginEmail, password) {
        const { data } = await api.post('/api/auth/login', { email: loginEmail, password });
        if (data.mfaRequired) return { done: false, stage: 'mfa', preAuthToken: data.preAuthToken };
        if (data.mfaSetupRequired) return { done: false, stage: 'mfa-setup', preAuthToken: data.preAuthToken };
        setSession(data.token, data.email, data.mustChangePassword, data.role, data.permissions);
        return { done: true };
      },
      async completeMfa(preAuthToken, code) {
        const { data } = await api.post('/api/auth/mfa/verify', { preAuthToken, code });
        setSession(data.token, data.email, data.mustChangePassword, data.role, data.permissions);
      },
      async completeMfaSetup(preAuthToken, secret, code) {
        const { data } = await api.post('/api/auth/mfa/setup/confirm', { preAuthToken, secret, code });
        setSession(data.token, data.email, data.mustChangePassword, data.role, data.permissions);
      },
      setSession,
      clearPasswordChange() {
        localStorage.setItem('adminMustChangePassword', 'false');
        setMustChangePassword(false);
      },
      logout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminEmail');
        localStorage.removeItem('adminMustChangePassword');
        localStorage.removeItem('adminRole');
        localStorage.removeItem('adminPermissions');
        setToken(null);
        setEmail(null);
        setMustChangePassword(false);
        setRole(null);
        setPermissions([]);
      },
    };
  }, [token, email, mustChangePassword, role, permissions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
