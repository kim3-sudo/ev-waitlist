import { CONNECTOR_STANDARD_OPTIONS } from '../../connectorOptions.js';

// Shared by the locator views. The server sends OCPI-style status names (see
// server/src/services/locator.js), so the labels and colours are keyed by those.

// The state of a charge point as a driver sees it. The colour is also used for map markers.
export const STATE_INFO = {
  AVAILABLE: { label: 'Available', color: '#2e7d32' },
  IN_USE: { label: 'In use', color: '#1565c0' },
  UNAVAILABLE: { label: 'Unavailable', color: '#ed6c02' },
  OFFLINE: { label: 'Offline', color: '#757575' },
};

// A single connector's status.
export const CONNECTOR_STATUS_LABEL = {
  AVAILABLE: 'Free',
  CHARGING: 'In use',
  BLOCKED: 'Busy',
  RESERVED: 'Reserved',
  INOPERATIVE: 'Out of service',
  OUTOFORDER: 'Faulted',
  UNKNOWN: 'Unknown',
};

export function standardName(value) {
  return CONNECTOR_STANDARD_OPTIONS.find((o) => o.value === value)?.name ?? value ?? 'Unknown plug';
}

// The price as a driver reads it, e.g. "USD 0.25 per minute".
export function formatRate(pricing) {
  if (!pricing || pricing.model === 'FREE') return 'Free';
  if (pricing.model === 'ENERGY') {
    return `${pricing.currency} ${(pricing.ratePerKwhCents / 100).toFixed(2)} per kWh`;
  }
  const unit = pricing.billingUnit === 'HOUR' ? 'hour' : 'minute';
  const suffix = pricing.hasTimeOfDayRates ? ' (rates vary by time of day)' : '';
  return `${pricing.currency} ${(pricing.rateCents / 100).toFixed(2)} per ${unit}${suffix}`;
}

export function formatDistance(km) {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatKw(kw) {
  return kw == null ? 'Power unknown' : `${kw} kW`;
}

// The map's tile server. The OpenStreetMap public tiles need the attribution below.
export const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// DC rapid charging and Level 1/2 (AC) are told apart on the map by colour. Orange and blue
// stay distinct for most colour-blind drivers.
export const CHARGER_TYPE_INFO = {
  DC: { label: 'DC rapid', color: '#e65100' },
  AC: { label: 'Level 1/2 (AC)', color: '#1565c0' },
};

// What a driver joins from a charge point: its zone when it has one, otherwise the charge
// point itself. "Start charging" when nobody is waiting and a charger is free now.
export function joinTargetFor(station) {
  const zone = station.zone;
  const waitingCount = zone ? zone.waitingCount : station.waitingCount;
  const free = zone ? zone.available : station.available;
  return {
    kind: zone ? 'zone' : 'station',
    id: zone ? zone.id : station.id,
    name: zone ? zone.name : station.name,
    waitingCount,
    mode: waitingCount === 0 && free ? 'start' : 'join',
    tips: station.tips ? [{ stationName: station.name, text: station.tips }] : [],
    priceNotices: station.notices?.pricing ?? [],
  };
}

// What a site offers nearby, and the parking at a site or charge point. The keys match
// server/src/services/siteFeatures.js.
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

// The labels for a list of keys, in the order of the options.
export function labelsFor(options, keys = []) {
  return options.filter((o) => keys.includes(o.key)).map((o) => o.label);
}
