// The address of a page for the site a driver is on. Public pages for a named site live under
// /t/<slug>, and the sign-in and driver pages follow the same pattern.
export function sitePath(path) {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/);
  return match ? `/t/${match[1]}${path}` : path;
}

// Where to go after signing in: a path on this site only, never another address.
export function safeNextPath(next, fallback) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}
