// Checks what a driver types as a contact. Email addresses go by e-mail; a mobile
// number must start with the country code (+1 555 123 4567) and is stored as E.164.

export function looksLikeEmail(text) {
  return typeof text === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

// Returns the number as +<digits>, or null if it is not a full international number.
export function normalizePhone(text) {
  if (typeof text !== 'string') return null;
  const compact = text.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
