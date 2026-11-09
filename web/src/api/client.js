import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
});

// The site a public page is showing (from its /t/<slug> address), or null for the
// default site. Public calls are sent to that site's routes.
let publicSite = null;
export function setPublicSite(slug) {
  publicSite = slug || null;
}

const PUBLIC_PATHS = ['/api/stations', '/api/zones', '/api/notices', '/api/waitlist', '/api/pay', '/api/settings', '/api/locator', '/api/pricing'];

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // The installation administrator can work on another site. The server ignores
    // this header for everyone else.
    const adminSite = localStorage.getItem('adminSite');
    if (adminSite) config.headers['X-Site'] = adminSite;
  }
  if (publicSite && PUBLIC_PATHS.some((p) => config.url === p || config.url?.startsWith(`${p}/`))) {
    config.url = config.url.replace('/api/', `/api/t/${publicSite}/`);
  }
  return config;
});

// The server refuses admin calls until a first-run admin changes their
// passphrase. Tell the auth context so it can send the user to that screen.
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
    window.dispatchEvent(new Event('auth:password-change-required'));
  }
  return Promise.reject(error);
});
