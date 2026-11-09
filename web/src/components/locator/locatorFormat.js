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

// The page a driver joins a waitlist on, for a site. The default site is at the root.
export function sitePagePath(site) {
  return site?.slug && site.slug !== 'default' ? `/t/${site.slug}` : '/';
}
