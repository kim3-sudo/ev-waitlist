import { ocpiTimestamp } from './envelope.js';
import { computeCharge } from '../services/payments/pricing.js';
import { DAY_NAMES, scheduleFor } from '../services/payments/rates.js';

// Turns our records into OCPI 2.2.1 objects. Everything here is a pure function of
// its inputs, so it can be tested directly.
//
// Known gaps, reported to partners as they are:
// - Stations do not capture city, postal code or country, so these are sent blank.
// - Each connector is published as its own EVSE, with a single connector each.
// - A station is only published when it has coordinates and every connector has
//   its standard, format, power type, voltage and amperage.

export const TARIFF_ID = 'DEFAULT';

// The values a connector must have before its station is published.
export const CONNECTOR_STANDARDS = [
  'CHADEMO', 'DOMESTIC_A', 'DOMESTIC_B', 'DOMESTIC_C', 'DOMESTIC_D', 'DOMESTIC_E', 'DOMESTIC_F', 'DOMESTIC_G',
  'DOMESTIC_H', 'DOMESTIC_I', 'DOMESTIC_J', 'DOMESTIC_K', 'DOMESTIC_L', 'IEC_62196_T1', 'IEC_62196_T1_COMBO',
  'IEC_62196_T2', 'IEC_62196_T2_COMBO', 'IEC_62196_T3A', 'IEC_62196_T3C', 'TESLA_R', 'TESLA_S',
];
export const CONNECTOR_FORMATS = ['CABLE', 'SOCKET'];
export const POWER_TYPES = ['AC_1_PHASE', 'AC_2_PHASE', 'AC_2_PHASE_SPLIT', 'AC_3_PHASE', 'DC'];

// Which power types each connector standard can carry. Standards not listed accept any
// power type. This mirrors web/src/connectorOptions.js, which greys out the same choices.
const AC_SINGLE_TWO_SPLIT = ['AC_1_PHASE', 'AC_2_PHASE', 'AC_2_PHASE_SPLIT'];
const AC_ALL = [...AC_SINGLE_TWO_SPLIT, 'AC_3_PHASE'];
const AC_SINGLE_ONLY = ['AC_1_PHASE'];
export const CONNECTOR_POWER_TYPES = {
  IEC_62196_T1: AC_SINGLE_TWO_SPLIT,
  IEC_62196_T1_COMBO: [...AC_SINGLE_TWO_SPLIT, 'DC'],
  IEC_62196_T2: AC_ALL,
  IEC_62196_T2_COMBO: [...AC_ALL, 'DC'],
  IEC_62196_T3A: AC_SINGLE_ONLY,
  IEC_62196_T3C: AC_SINGLE_ONLY,
  CHADEMO: ['DC'],
  TESLA_S: ['AC_1_PHASE', 'AC_2_PHASE_SPLIT', 'DC'],
  TESLA_R: AC_ALL,
  DOMESTIC_A: AC_SINGLE_ONLY,
  DOMESTIC_B: AC_SINGLE_ONLY,
  DOMESTIC_C: AC_SINGLE_ONLY,
  DOMESTIC_D: AC_SINGLE_ONLY,
  DOMESTIC_E: AC_SINGLE_ONLY,
  DOMESTIC_F: AC_SINGLE_ONLY,
  DOMESTIC_G: AC_SINGLE_ONLY,
  DOMESTIC_H: AC_SINGLE_ONLY,
  DOMESTIC_I: AC_SINGLE_ONLY,
  DOMESTIC_J: AC_SINGLE_ONLY,
  DOMESTIC_K: AC_SINGLE_ONLY,
  DOMESTIC_L: AC_SINGLE_ONLY,
};

// True when the standard can carry the power type (or the standard has no rule).
export function powerTypeAllowed(standard, powerType) {
  const allowed = CONNECTOR_POWER_TYPES[standard];
  return !allowed || allowed.includes(powerType);
}

// True when a connector has every detail partners need.
export function connectorIsComplete(c) {
  return Boolean(
    c.standard && c.format && c.powerType && c.maxVoltage != null && c.maxAmperage != null,
  );
}

// True when a station can be published to partners: it has coordinates, and each
// of its connectors is complete.
export function stationIsPublishable(station) {
  if (station.latitude == null || station.longitude == null) return false;
  const connectors = station.connectors.filter((c) => c.connectorId > 0);
  return connectors.length > 0 && connectors.every(connectorIsComplete);
}


// OCPP connector status -> OCPI EVSE status.
export function ocppToOcpiStatus(status) {
  switch (status) {
    case 'Available':
      return 'AVAILABLE';
    case 'Preparing':
    case 'SuspendedEV':
    case 'SuspendedEVSE':
    case 'Finishing':
      return 'BLOCKED';
    case 'Charging':
      return 'CHARGING';
    case 'Reserved':
      return 'RESERVED';
    case 'Unavailable':
      return 'INOPERATIVE';
    case 'Faulted':
      return 'OUTOFORDER';
    default:
      return 'UNKNOWN';
  }
}

const alnum = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// OCPI EVSE uid: unique within the operator's party. Limited to 39 characters.
export function evseUid(station, connectorId) {
  return `${station.identity}-${connectorId}`.slice(0, 39);
}

// eMI3 EVSE-ID: country*party*E<id>, at most 37 characters.
export function evseId(operator, station, connectorId) {
  return `${operator.countryCode}*${operator.partyId}*E${alnum(station.identity)}${connectorId}`.slice(0, 37);
}

function ocpiDecimal(value, places = 2) {
  return Number(value).toFixed(places);
}

function publishedConnectors(station) {
  return station.connectors
    .filter((c) => c.connectorId > 0)
    .sort((a, b) => a.connectorId - b.connectorId);
}

function locationFields(station) {
  return {
    address: station.location || station.name,
    city: '',
    postal_code: '',
    country: '',
    coordinates: { latitude: String(station.latitude), longitude: String(station.longitude) },
  };
}

export function locationOf(operator, station, lastUpdated = new Date()) {
  return {
    country_code: operator.countryCode,
    party_id: operator.partyId,
    id: station.id,
    publish: true,
    name: station.name,
    ...locationFields(station),
    evses: publishedConnectors(station).map((c) => ({
      uid: evseUid(station, c.connectorId),
      evse_id: evseId(operator, station, c.connectorId),
      status: ocppToOcpiStatus(c.status),
      connectors: [
        {
          id: String(c.connectorId),
          standard: c.standard,
          format: c.format,
          power_type: c.powerType,
          max_voltage: c.maxVoltage,
          max_amperage: c.maxAmperage,
          tariff_ids: [TARIFF_ID],
          last_updated: ocpiTimestamp(lastUpdated),
        },
      ],
      last_updated: ocpiTimestamp(lastUpdated),
    })),
    operator: { name: operator.name || undefined },
    time_zone: 'UTC',
    last_updated: ocpiTimestamp(lastUpdated),
  };
}

// The status of one EVSE, for a partial update.
export function evseStatusOf(station, connector) {
  return {
    uid: evseUid(station, connector.connectorId),
    status: ocppToOcpiStatus(connector.status),
    last_updated: ocpiTimestamp(),
  };
}

// The site's tariff, from its payment settings.
// OCPI restrictions for one time window. OCPI times are HH:MM, and a window that
// ends at midnight is sent as 23:59. A window that runs past midnight is split
// into its two halves, one on each day.
function restrictionsOf(window) {
  const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;
  const end = window.endHour === 24 ? '23:59' : hhmm(window.endHour);
  if (window.startHour < window.endHour) {
    return [{ day_of_week: window.days.map((d) => DAY_NAMES[d]), start_time: hhmm(window.startHour), end_time: end }];
  }
  const restrictions = [];
  for (const day of window.days) {
    restrictions.push({ day_of_week: [DAY_NAMES[day]], start_time: hhmm(window.startHour), end_time: '23:59' });
    if (window.endHour > 0) {
      restrictions.push({ day_of_week: [DAY_NAMES[(day + 1) % 7]], start_time: '00:00', end_time: hhmm(window.endHour) });
    }
  }
  return restrictions;
}

export function tariffOf(operator, settings, lastUpdated = new Date()) {
  const elements = [];
  if (settings.pricingModel === 'ENERGY') {
    elements.push({
      price_components: [
        { type: 'ENERGY', price: ocpiDecimal(settings.ratePerKwhCents / 100), step_size: 1 },
      ],
    });
  } else {
    // Each time window becomes one or more restricted elements. The base rate comes
    // last, because OCPI applies the first element whose restrictions match.
    // Rates are cents per minute or per hour, depending on the billing unit. Prices are
    // sent per hour, with the billing step in seconds, so the partner bills the same way.
    const perHour = settings.timeBillingUnit === 'HOUR';
    const stepSize = perHour ? 3600 : 60;
    const hourly = (cents) => ocpiDecimal(perHour ? cents / 100 : (cents * 60) / 100);
    const free = settings.pricingModel === 'FREE';
    for (const window of free ? [] : scheduleFor(settings)) {
      for (const restrictions of restrictionsOf(window)) {
        elements.push({ price_components: [{ type: 'TIME', price: hourly(window.rate), step_size: stepSize }], restrictions });
      }
    }
    elements.push({
      price_components: [{ type: 'TIME', price: hourly(free ? 0 : settings.ratePerMinuteCents), step_size: stepSize }],
    });
  }
  return {
    country_code: operator.countryCode,
    party_id: operator.partyId,
    id: TARIFF_ID,
    currency: settings.currency,
    elements,
    last_updated: ocpiTimestamp(lastUpdated),
  };
}

function cdrTokenOf(operator, token, uid) {
  return {
    country_code: token?.country ?? operator.countryCode,
    party_id: token?.party ?? operator.partyId,
    uid,
    type: token?.type ?? 'OTHER',
    contract_id: token?.contractId ?? '',
  };
}

function kwhOf(tx) {
  if (tx.meterStart == null || tx.meterStop == null || tx.meterStop < tx.meterStart) return null;
  return (tx.meterStop - tx.meterStart) / 1000;
}

// A session in progress, or finished. Sent to the partner that started it.
export function sessionOf(operator, station, tx, token, settings, lastUpdated = new Date()) {
  const kwh = kwhOf(tx);
  const connector = { connectorId: tx.connectorId };
  return {
    country_code: operator.countryCode,
    party_id: operator.partyId,
    id: tx.id,
    start_date_time: ocpiTimestamp(tx.startedAt),
    ...(tx.stoppedAt ? { end_date_time: ocpiTimestamp(tx.stoppedAt) } : {}),
    kwh: ocpiDecimal(kwh ?? 0, 3),
    cdr_token: cdrTokenOf(operator, token, tx.idTag),
    auth_method: 'WHITELIST',
    location_id: station.id,
    evse_uid: evseUid(station, connector.connectorId),
    connector_id: String(connector.connectorId),
    currency: settings.currency,
    status: tx.stoppedAt ? 'COMPLETED' : 'ACTIVE',
    last_updated: ocpiTimestamp(lastUpdated),
  };
}

// A charge detail record, for a finished roaming session. The cost is worked out
// from the site's pricing at the time it is built.
export function cdrOf(operator, station, tx, token, settings) {
  const charge = computeCharge(settings, {
    startedAt: tx.startedAt,
    stoppedAt: tx.stoppedAt,
    meterStart: tx.meterStart,
    meterStop: tx.meterStop,
  });
  const minutes = charge.durationSeconds / 60;
  const kwh = charge.energyWh == null ? 0 : charge.energyWh / 1000;
  const tariff = tariffOf(operator, settings, tx.stoppedAt);
  return {
    country_code: operator.countryCode,
    party_id: operator.partyId,
    id: tx.id,
    start_date_time: ocpiTimestamp(tx.startedAt),
    end_date_time: ocpiTimestamp(tx.stoppedAt),
    cdr_token: cdrTokenOf(operator, token, tx.idTag),
    auth_method: 'WHITELIST',
    cdr_location: {
      id: station.id,
      evse_uid: evseUid(station, tx.connectorId),
      connector_id: String(tx.connectorId),
      ...locationFields(station),
    },
    currency: settings.currency,
    tariffs: [tariff],
    charging_periods: [
      {
        start_date_time: ocpiTimestamp(tx.startedAt),
        dimensions: [
          { type: 'TIME', volume: ocpiDecimal(minutes, 2) },
          { type: 'ENERGY', volume: ocpiDecimal(kwh, 3) },
        ],
      },
    ],
    total_cost: { excl_vat: ocpiDecimal(charge.amountCents / 100) },
    total_energy: ocpiDecimal(kwh, 3),
    total_time: ocpiDecimal(minutes, 2),
    last_updated: ocpiTimestamp(tx.stoppedAt),
  };
}
