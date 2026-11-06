import { createTheme } from '@mui/material/styles';

// Google Fonts offered on the branding page. The admin can search this list, or type
// the name of any other Google Font. The category sets the fallback font in the stack.
// Names here are checked against the Google Fonts catalogue; a name that is not on
// Google Fonts simply falls back to the browser's default.
export const COMMON_GOOGLE_FONTS = [
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Noto Sans', category: 'sans-serif' },
  { family: 'Source Sans 3', category: 'sans-serif' },
  { family: 'PT Sans', category: 'sans-serif' },
  { family: 'Ubuntu', category: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif' },
  { family: 'Rubik', category: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif' },
  { family: 'IBM Plex Sans', category: 'sans-serif' },
  { family: 'Fira Sans', category: 'sans-serif' },
  { family: 'Karla', category: 'sans-serif' },
  { family: 'Mulish', category: 'sans-serif' },
  { family: 'Quicksand', category: 'sans-serif' },
  { family: 'Barlow', category: 'sans-serif' },
  { family: 'Archivo', category: 'sans-serif' },
  { family: 'Libre Franklin', category: 'sans-serif' },
  { family: 'Titillium Web', category: 'sans-serif' },
  { family: 'Exo 2', category: 'sans-serif' },
  { family: 'Outfit', category: 'sans-serif' },
  { family: 'Plus Jakarta Sans', category: 'sans-serif' },
  { family: 'Figtree', category: 'sans-serif' },
  { family: 'Lexend', category: 'sans-serif' },
  { family: 'Sora', category: 'sans-serif' },
  { family: 'Urbanist', category: 'sans-serif' },
  { family: 'Public Sans', category: 'sans-serif' },
  { family: 'Red Hat Display', category: 'sans-serif' },
  { family: 'Space Grotesk', category: 'sans-serif' },
  { family: 'Hanken Grotesk', category: 'sans-serif' },
  { family: 'Oxygen', category: 'sans-serif' },
  { family: 'Asap', category: 'sans-serif' },
  { family: 'Heebo', category: 'sans-serif' },
  { family: 'Hind', category: 'sans-serif' },
  { family: 'Kanit', category: 'sans-serif' },
  { family: 'Overpass', category: 'sans-serif' },
  { family: 'Oswald', category: 'sans-serif' },
  { family: 'Bebas Neue', category: 'sans-serif' },
  { family: 'Josefin Sans', category: 'sans-serif' },
  { family: 'Cabin', category: 'sans-serif' },
  { family: 'Dosis', category: 'sans-serif' },
  { family: 'Arimo', category: 'sans-serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Noto Serif', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'Crimson Text', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'Roboto Slab', category: 'serif' },
  { family: 'Zilla Slab', category: 'serif' },
  { family: 'Arvo', category: 'serif' },
  { family: 'Gelasio', category: 'serif' },
  { family: 'Tinos', category: 'serif' },
  { family: 'Roboto Mono', category: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace' },
  { family: 'JetBrains Mono', category: 'monospace' },
  { family: 'Fira Code', category: 'monospace' },
  { family: 'IBM Plex Mono', category: 'monospace' },
  { family: 'Space Mono', category: 'monospace' },
  { family: 'Courier Prime', category: 'monospace' },
  { family: 'Pacifico', category: 'sans-serif' },
  { family: 'Lobster', category: 'sans-serif' },
  { family: 'Dancing Script', category: 'sans-serif' },
];

const FALLBACK = { 'sans-serif': 'sans-serif', serif: 'serif', monospace: 'monospace' };

// The CSS font stack for a Google Font family, with a generic fallback.
export function fontStackFor(family, category = 'sans-serif') {
  if (!family) return '';
  return `${family}, ${FALLBACK[category] ?? 'sans-serif'}`;
}

// The Google Font family named by a stored font stack ("Inter, sans-serif" -> "Inter"), or null.
export function fontFamilyName(stored) {
  const name = (stored ?? '').split(',')[0].trim();
  return name || null;
}

// The category for a family on the common list, used when an admin picks one.
export function categoryFor(family) {
  return COMMON_GOOGLE_FONTS.find((f) => f.family === family)?.category ?? 'sans-serif';
}

const GOOGLE_FONT_LINK_ID = 'branding-google-font';
const GOOGLE_FONT_PREVIEW_LINK_ID = 'branding-font-previews';

function googleFontsHref(families) {
  const params = families.map((name) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}`).join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

// Loads the chosen Google Font, so the custom fontFamily set in the theme actually
// renders instead of falling back to the browser default.
export function loadBrandFont(fontFamily) {
  const name = fontFamilyName(fontFamily);
  const existing = document.getElementById(GOOGLE_FONT_LINK_ID);

  if (!name) {
    existing?.remove();
    return;
  }

  const href = googleFontsHref([name]);
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

// Loads several Google Fonts at once, so the branding page can show each name in its own face.
export function loadFontPreviews(families) {
  let link = document.getElementById(GOOGLE_FONT_PREVIEW_LINK_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = GOOGLE_FONT_PREVIEW_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  const href = googleFontsHref(families);
  if (link.href !== href) link.href = href;
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
