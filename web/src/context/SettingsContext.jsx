import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';

const DEFAULT_SETTINGS = {
  companyName: 'EV Waitlist',
  logoUrl: null,
  primaryColor: '#0d7a5f',
  secondaryColor: '#1565c0',
  fontFamily: null,
  identifierMode: 'LICENSE_PLATE',
};

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/api/settings');
      setSettings(data);
    } catch {
      // keep the previous (or default) branding if this fails
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loaded, refresh }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
