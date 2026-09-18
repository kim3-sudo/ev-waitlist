import { createTheme } from '@mui/material/styles';

// Curated so the admin picks from fonts we know how to load (via Google
// Fonts) rather than typing an arbitrary, possibly-unavailable font stack.
export const FONT_OPTIONS = [
  { label: 'Default', value: '', googleFont: null },
  { label: 'Inter', value: 'Inter, sans-serif', googleFont: 'Inter:wght@400;500;600;700' },
  { label: 'Roboto', value: 'Roboto, sans-serif', googleFont: 'Roboto:wght@400;500;700' },
  { label: 'Poppins', value: 'Poppins, sans-serif', googleFont: 'Poppins:wght@400;500;600;700' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif', googleFont: 'Montserrat:wght@400;500;600;700' },
  { label: 'Merriweather', value: 'Merriweather, serif', googleFont: 'Merriweather:wght@400;700' },
];

const GOOGLE_FONT_LINK_ID = 'branding-google-font';

// Injects (or replaces) a <link> tag pulling the chosen Google Font, so the
// custom fontFamily set in the theme actually renders instead of falling
// back to the browser default.
export function loadBrandFont(fontFamily) {
  const option = FONT_OPTIONS.find((f) => f.value === fontFamily);
  const existing = document.getElementById(GOOGLE_FONT_LINK_ID);

  if (!option?.googleFont) {
    existing?.remove();
    return;
  }

  const href = `https://fonts.googleapis.com/css2?family=${option.googleFont}&display=swap`;
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }

  const link = document.createElement('link');
  link.id = GOOGLE_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

export function buildTheme(settings) {
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: settings?.primaryColor || '#0d7a5f' },
      secondary: { main: settings?.secondaryColor || '#1565c0' },
      background: { default: '#f4f6f5' },
    },
    shape: { borderRadius: 10 },
    typography: settings?.fontFamily ? { fontFamily: settings.fontFamily } : undefined,
  });
}
