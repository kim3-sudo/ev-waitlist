import { rawPrisma } from '../db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import { registry } from './stationRegistry.js';
import { stationNotices } from './notices.js';
import { getPaymentSettings } from './payments/paymentSettingsService.js';
import { stationIsPublishable, ocppToOcpiStatus } from '../ocpi/mappers.js';
import { readParkingKeys, siteFeaturesView } from './siteFeatures.js';

// Backs the charger locator: the public map, list and by-site views. Only stations
// that are publishable (coordinates and complete connectors) are ever returned, the
// same rule the roaming feed uses.

// Power in kW from voltage and amperage. Three-phase is line voltage times the
// square root of three. Returns null when the connector has no rating.
export function connectorKw(connector) {
  if (connector.maxVoltage == null || connector.maxAmperage == null) return null;
  const volaAmps = connector.maxVoltage * connector.maxAmperage;
  const watts = connector.powerType === 'AC_3_PHASE' ? Math.sqrt(3) * volaAmps : volaAmps;
  return Math.round(watts / 100) / 10;
}

// Great-circle distance between two points, in kilometres.
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Coordinates are optional. Give both, or neither. Returns an error message or null.
export function coordinatesProblem(latitude, longitude) {
  const lat = latitude === '' ? null : latitude;
  const lon = longitude === '' ? null : longitude;
  if ((lat == null) !== (lon == null)) return 'Give both latitude and longitude, or neither';
  if (lat == null) return null;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'latitude must be a number from -90 to 90';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'longitude must be a number from -180 to 180';
  return null;
}

// Trims a text field from a request. Empty becomes null. Returns { value } or { error }.
export function cleanText(value, label, max = 120) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > max) return { error: `${label} must be ${max} characters at most` };
  return { value: trimmed };
}

// The locator text fields a station or site can set. Returns { fields } or { error }.
// Undefined fields are left out, so an update changes only what was sent.
export function locatorTextFields(body, { hoursMax = 200, amenitiesMax = 300 } = {}) {
  const pairs = [
    ['city', 'City'],
    ['postalCode', 'Postal code', 20],
    ['country', 'Country', 60],
    ['hours', 'Hours', hoursMax],
    ['amenities', 'Amenities', amenitiesMax],
  ];
  const fields = {};
  for (const [key, label, max] of pairs) {
    const result = cleanText(body?.[key], label, max);
    if (result.error) return { error: result.error };
    if (result.value !== undefined) fields[key] = result.value;
  }
  return { fields };
}

// A station's own detail, falling back to the site's where it is blank.
export function locatorDetails(station, tenant) {
  const pick = (own, site) => (own?.trim() ? own.trim() : site ?? null);
  return {
    address: station.location?.trim() || tenant?.address || null,
    city: pick(station.city, tenant?.city),
    postalCode: pick(station.postalCode, tenant?.postalCode),
    country: pick(station.country, tenant?.country),
    hours: pick(station.hours, tenant?.hours),
    amenities: pick(station.amenities, tenant?.amenities),
  };
}

// Connector standards and their connectors, as drivers see them.
function connectorsOf(station) {
  return station.connectors
    .filter((c) => c.connectorId > 0)
    .sort((a, b) => a.connectorId - b.connectorId)
    .map((c) => ({
      connectorId: c.connectorId,
      standard: c.standard,
      format: c.format,
      powerType: c.powerType,
      kw: connectorKw(c),
      status: ocppToOcpiStatus(c.status),
    }));
}

// The charge point is open for use: connected, and at least one connector is free.
function isAvailable(station, connectors) {
  return registry.isConnected(station.identity) && connectors.some((c) => c.status === 'AVAILABLE');
}

// Drivers see a charge point in one of these states.
export function stateOf(station, connectors) {
  if (!registry.isConnected(station.identity)) return 'OFFLINE';
  if (isAvailable(station, connectors)) return 'AVAILABLE';
  if (connectors.some((c) => c.status === 'CHARGING')) return 'IN_USE';
  return 'UNAVAILABLE';
}

// DC rapid charging if any connector is DC; otherwise Level 1/2 (AC).
export function chargerTypeOf(connectors) {
  return connectors.some((c) => c.powerType === 'DC') ? 'DC' : 'AC';
}

// The public form of one published station. `notices` comes from stationNotices.
// `zoneAvailable` says whether any charge point in the station's zone is free now.
// The waiting counts let the drawer say "Start charging" or "Join waitlist".
export function serializeLocatorStation(station, { tenant, notices, pricing, zoneAvailable = false }) {
  const connectors = connectorsOf(station);
  const details = locatorDetails(station, tenant);
  const kws = connectors.map((c) => c.kw).filter((kw) => kw != null);
  return {
    id: station.id,
    name: station.name,
    ...details,
    latitude: station.latitude,
    longitude: station.longitude,
    site: { id: tenant.id, slug: tenant.slug, name: tenant.name, features: siteFeaturesView(tenant) },
    zone: station.zone
      ? {
          id: station.zone.id,
          name: station.zone.name,
          waitingCount: station.zone._count?.queueEntries ?? 0,
          available: zoneAvailable,
        }
      : null,
    state: stateOf(station, connectors),
    available: isAvailable(station, connectors),
    chargerType: chargerTypeOf(connectors),
    // Parking at this charge point. The site's own parking is in site.features.
    parking: readParkingKeys(station.parkingKeys),
    maxKw: kws.length ? Math.max(...kws) : null,
    connectors,
    waitingCount: station.queueEntries?.length ?? 0,
    tips: station.tips ?? null,
    pricing: pricing ?? null,
    notices: notices ?? { alerts: [], pricing: [] },
  };
}

// A charge point can be free now: connected, with a connector available.
function availableNow(station) {
  return isAvailable(station, connectorsOf(station));
}

// The site's pricing as a driver sees it. Null for a free site.
export function pricingSummary(settings) {
  if (!settings || settings.pricingModel === 'FREE') return { model: 'FREE' };
  if (settings.pricingModel === 'ENERGY') {
    return { model: 'ENERGY', currency: settings.currency, ratePerKwhCents: settings.ratePerKwhCents };
  }
  // TIME: the rate is charged per billing unit, which is a minute or an hour.
  return {
    model: 'TIME',
    currency: settings.currency,
    billingUnit: settings.timeBillingUnit === 'HOUR' ? 'HOUR' : 'MINUTE',
    rateCents: settings.ratePerMinuteCents,
    hasTimeOfDayRates: Boolean(settings.rateSchedule),
  };
}

// The stations to show, across the given sites (or all sites when tenantIds is null).
// Each is returned with its site, zone and connectors, already serialized.
export async function publishedLocatorStations({ tenantIds = null } = {}) {
  const waiting = { where: { status: 'WAITING' }, select: { id: true } };
  const stations = await rawPrisma.station.findMany({
    where: tenantIds ? { tenantId: { in: tenantIds } } : {},
    include: {
      connectors: true,
      tenant: true,
      queueEntries: waiting,
      zone: { include: { _count: { select: { queueEntries: { where: { status: 'WAITING' } } } } } },
    },
    orderBy: { name: 'asc' },
  });
  // A zone is free when any of its charge points is, including ones not shown on the map.
  const zoneFree = new Set(stations.filter((s) => s.zoneId && availableNow(s)).map((s) => s.zoneId));
  const publishable = stations.filter(stationIsPublishable);

  // Notices and pricing depend on the site, so each site's stations are read in its context.
  const byTenant = new Map();
  for (const station of publishable) {
    if (!byTenant.has(station.tenantId)) byTenant.set(station.tenantId, []);
    byTenant.get(station.tenantId).push(station);
  }

  const out = [];
  for (const [tenantId, list] of byTenant) {
    const tenant = list[0].tenant;
    const { notices, pricing } = await runWithTenant(tenantId, async () => ({
      notices: await stationNotices(list),
      pricing: pricingSummary(await getPaymentSettings()),
    }));
    for (const station of list) {
      out.push(
        serializeLocatorStation(station, {
          tenant,
          notices: notices.get(station.id),
          pricing,
          zoneAvailable: zoneFree.has(station.zoneId),
        }),
      );
    }
  }
  return out;
}

// Filters and sorts a list of serialized stations (see publishedLocatorStations).
// Recognised query: { bbox: 'west,south,east,north', near: {lat,lng,radiusKm},
// q, standard, minKw, availableOnly, sort: 'distance'|'power'|'name' }.
// `standard` may be one plug or a list. A charge point matches when it has any of them.
// chargerTypes ('AC'|'DC', any of them), minChargers (the site has at least this many charge
// points), amenities and parking (the site or charge point has all of them).
export function filterLocatorStations(stations, options = {}) {
  const { bbox, near, q, standard, minKw, availableOnly, sort, chargerTypes, minChargers, amenities, parking } = options;
  const needle = q?.trim().toLowerCase();
  const plugs = [standard].flat().filter(Boolean);
  const types = chargerTypes ?? [];
  const wantedAmenities = amenities ?? [];
  const wantedParking = parking ?? [];
  // How many charge points each site has in this list, before the filters narrow it.
  const siteCounts = new Map();
  for (const s of stations) siteCounts.set(s.site.id, (siteCounts.get(s.site.id) ?? 0) + 1);
  let result = stations.filter((s) => {
    if (types.length && !types.includes(s.chargerType)) return false;
    if (minChargers != null && siteCounts.get(s.site.id) < minChargers) return false;
    if (wantedAmenities.length && !wantedAmenities.every((a) => s.site.features.amenities.includes(a))) return false;
    if (wantedParking.length) {
      const offered = [...s.parking, ...s.site.features.parking];
      if (!wantedParking.every((p) => offered.includes(p))) return false;
    }
    if (bbox) {
      const [w, so, e, n] = bbox;
      if (s.longitude < w || s.longitude > e || s.latitude < so || s.latitude > n) return false;
    }
    if (needle) {
      const haystack = [s.name, s.address, s.city, s.postalCode, s.site.name].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (plugs.length && !s.connectors.some((c) => plugs.includes(c.standard))) return false;
    if (minKw != null && !(s.maxKw != null && s.maxKw >= minKw)) return false;
    if (availableOnly && !s.available) return false;
    if (near) {
      const km = haversineKm(near.lat, near.lng, s.latitude, s.longitude);
      if (near.radiusKm != null && km > near.radiusKm) return false;
      s.distanceKm = Math.round(km * 10) / 10;
    }
    return true;
  });

  const byName = (a, b) => a.name.localeCompare(b.name);
  if (sort === 'power') result = result.sort((a, b) => (b.maxKw ?? 0) - (a.maxKw ?? 0) || byName(a, b));
  else if (sort === 'distance' && near) result = result.sort((a, b) => a.distanceKm - b.distanceKm);
  else result = result.sort(byName);
  return result;
}

// Groups serialized stations by site, then zone (standalone stations go under "Standalone").
// Each site carries counts, its highest power and its location, for the by-site view.
export function groupBySite(stations, sites) {
  const bySite = new Map();
  for (const s of stations) {
    if (!bySite.has(s.site.id)) bySite.set(s.site.id, []);
    bySite.get(s.site.id).push(s);
  }
  return [...bySite.entries()]
    .map(([siteId, list]) => {
      const site = sites.get(siteId);
      const zones = new Map();
      for (const s of list) {
        const key = s.zone?.id ?? 'standalone';
        if (!zones.has(key)) zones.set(key, { id: s.zone?.id ?? null, name: s.zone?.name ?? 'Standalone', stations: [] });
        zones.get(key).stations.push(s);
      }
      const kws = list.map((s) => s.maxKw).filter((kw) => kw != null);
      return {
        id: site.id,
        slug: site.slug,
        name: site.name,
        address: site.address,
        city: site.city,
        postalCode: site.postalCode,
        country: site.country,
        latitude: site.latitude,
        longitude: site.longitude,
        hours: site.hours,
        amenities: site.amenities,
        isDefault: site.id === DEFAULT_TENANT_ID,
        chargerCount: list.length,
        availableCount: list.filter((s) => s.available).length,
        features: siteFeaturesView(site),
        maxKw: kws.length ? Math.max(...kws) : null,
        zones: [...zones.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The sites that hold the given stations, keyed by id.
export async function sitesById(tenantIds = null) {
  const sites = await rawPrisma.tenant.findMany({
    where: tenantIds ? { id: { in: tenantIds } } : undefined,
  });
  return new Map(sites.map((t) => [t.id, t]));
}
