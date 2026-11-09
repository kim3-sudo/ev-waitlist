// What a site offers nearby, and the parking at a site or charge point. The admin ticks these;
// drivers see them in the charger locator. Stored as JSON lists of keys. The web app has the
// same keys and labels (web/src/components/locator/locatorFormat.js), so keep them in step.

export const AMENITY_OPTIONS = [
  { key: 'DINING', label: 'Dining nearby' },
  { key: 'RESTROOMS', label: 'Restrooms' },
  { key: 'SHOPPING', label: 'Shopping' },
  { key: 'LODGING', label: 'Lodging' },
  { key: 'PARKS', label: 'Public parks' },
  { key: 'GROCERY', label: 'Grocery' },
  { key: 'WIFI', label: 'Wi-Fi' },
  { key: 'CAMPING', label: 'Camping' },
  { key: 'FREE_CHARGING', label: 'Free charging' },
];

export const PARKING_OPTIONS = [
  { key: 'ACCESSIBLE', label: 'Accessible parking' },
  { key: 'COVERED', label: 'Covered by a canopy' },
  { key: 'GARAGE', label: 'In a garage' },
  { key: 'ILLUMINATED', label: 'Illuminated' },
  { key: 'PULL_THROUGH', label: 'Pull-through (for trailers)' },
  { key: 'TRAILER_FRIENDLY', label: 'Trailer-friendly' },
];

const AMENITY_KEYS = AMENITY_OPTIONS.map((o) => o.key);
const PARKING_KEYS = PARKING_OPTIONS.map((o) => o.key);

// Reads a stored JSON list, keeping only keys that are still known. Bad JSON gives an empty list.
function readKeys(text, known) {
  try {
    const list = JSON.parse(text ?? '[]');
    return Array.isArray(list) ? list.filter((k) => known.includes(k)) : [];
  } catch {
    return [];
  }
}

export const readAmenityKeys = (text) => readKeys(text, AMENITY_KEYS);
export const readParkingKeys = (text) => readKeys(text, PARKING_KEYS);

// Checks a list sent by the admin form. Returns { value } (the JSON to store) or { error }.
// Undefined means the field was not sent, so the caller leaves it alone.
function normalizeKeys(input, known, label) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: null };
  if (!Array.isArray(input)) return { error: `${label} must be a list` };
  const unknown = input.find((k) => !known.includes(k));
  if (unknown !== undefined) return { error: `${label} has an option that is not recognised: ${String(unknown)}` };
  const unique = [...new Set(input)];
  return { value: unique.length ? JSON.stringify(unique) : null };
}

export const normalizeAmenityKeys = (input) => normalizeKeys(input, AMENITY_KEYS, 'Amenities');
export const normalizeParkingKeys = (input) => normalizeKeys(input, PARKING_KEYS, 'Parking');

// The site's features as drivers see them.
export function siteFeaturesView(site) {
  return {
    amenities: readAmenityKeys(site?.amenityKeys),
    parking: readParkingKeys(site?.parkingKeys),
    accessControlled: Boolean(site?.accessControlled),
  };
}

export const AMENITY_KEY_LIST = AMENITY_KEYS;
export const PARKING_KEY_LIST = PARKING_KEYS;
