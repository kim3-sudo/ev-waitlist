import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router-dom';
import { buildTheme, loadBrandFont } from './theme.js';
import { AuthProvider } from './context/AuthContext.jsx';
import { SettingsProvider, useSettings } from './context/SettingsContext.jsx';
import App from './App.jsx';

function ThemedApp() {
  const { settings } = useSettings();
  const theme = useMemo(() => buildTheme(settings), [settings]);

  useEffect(() => {
    loadBrandFont(settings.fontFamily);
  }, [settings.fontFamily]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SettingsProvider>
      <ThemedApp />
    </SettingsProvider>
  </StrictMode>,
);
