import { createContext, useContext, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('adminToken'));
  const [email, setEmail] = useState(() => localStorage.getItem('adminEmail'));

  const value = useMemo(() => {
    function setSession(newToken, newEmail) {
      localStorage.setItem('adminToken', newToken);
      localStorage.setItem('adminEmail', newEmail);
      setToken(newToken);
      setEmail(newEmail);
    }

    return {
      token,
      email,
      isAuthenticated: Boolean(token),
      async login(loginEmail, password) {
        const { data } = await api.post('/api/auth/login', { email: loginEmail, password });
        if (data.mfaRequired) return { done: false, stage: 'mfa', preAuthToken: data.preAuthToken };
        if (data.mfaSetupRequired) return { done: false, stage: 'mfa-setup', preAuthToken: data.preAuthToken };
        setSession(data.token, data.email);
        return { done: true };
      },
      async completeMfa(preAuthToken, code) {
        const { data } = await api.post('/api/auth/mfa/verify', { preAuthToken, code });
        setSession(data.token, data.email);
      },
      async completeMfaSetup(preAuthToken, secret, code) {
        const { data } = await api.post('/api/auth/mfa/setup/confirm', { preAuthToken, secret, code });
        setSession(data.token, data.email);
      },
      setSession,
      logout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminEmail');
        setToken(null);
        setEmail(null);
      },
    };
  }, [token, email]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
