import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { AMENITY_KEY_LIST, PARKING_KEY_LIST } from '../services/siteFeatures.js';
import {
  filterLocatorStations,
  groupBySite,
  publishedLocatorStations,
  sitesById,
} from '../services/locator.js';

// The public charger locator: a list, a by-site view and map points. Mounted at
// /api/locator for every site, and at /api/t/<slug>/locator for one site, where
// req.tenantId is set by tenantFromSlug.
export const locatorRouter = Router();

// Parses the query string into filter options. Bad values are ignored rather than refused.
function optionsFrom(query) {
  const options = {};
  const bbox = typeof query.bbox === 'string' ? query.bbox.split(',').map(Number) : null;
  if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) options.bbox = bbox;

  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (query.lat !== undefined && query.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)) {
    const radius = Number(query.radiusKm);
    options.near = { lat, lng, radiusKm: Number.isFinite(radius) && radius > 0 ? radius : null };
  }
  if (typeof query.q === 'string' && query.q.trim()) options.q = query.q.trim().slice(0, 100);
  // Several plugs can be asked for at once, separated by commas.
  if (typeof query.standard === 'string') {
    const plugs = query.standard.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 20);
    if (plugs.length) options.standard = plugs;
  }
  const minKw = Number(query.minKw);
  if (query.minKw !== undefined && Number.isFinite(minKw) && minKw > 0) options.minKw = minKw;
  options.availableOnly = query.available === '1' || query.available === 'true';
  if (['distance', 'power', 'name'].includes(query.sort)) options.sort = query.sort;
  // Each of these takes a comma-separated list. Unknown items are dropped.
  const list = (value) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : []);
  const types = list(query.type).filter((t) => ['AC', 'DC'].includes(t));
  if (types.length) options.chargerTypes = types;
  const minChargers = Number(query.minChargers);
  if (query.minChargers !== undefined && Number.isInteger(minChargers) && minChargers > 0) options.minChargers = minChargers;
  const amenities = list(query.amenities).filter((a) => AMENITY_KEY_LIST.includes(a));
  if (amenities.length) options.amenities = amenities;
  const parking = list(query.parking).filter((p) => PARKING_KEY_LIST.includes(p));
  if (parking.length) options.parking = parking;
  return options;
}

// The sites this request covers: one for a site route, every site otherwise.
function scopeOf(req) {
  return req.tenantId ? [req.tenantId] : null;
}

// Pages of results. The list and by-site views load a page at a time as the driver scrolls,
// and the map asks for the points in view. Bad values fall back to the defaults.
export const CHARGER_PAGE = 25;
export const SITE_PAGE = 10;
const MAX_PAGE = 500;
export function pageFrom(query, fallback) {
  const limit = Number(query.limit);
  const offset = Number(query.offset);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_PAGE) : fallback,
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

// One page of charge points. `count` is every charge point that matches, `hasMore` says whether
// a later page exists.
locatorRouter.get('/stations', async (req, res) => {
  const stations = await publishedLocatorStations({ tenantIds: scopeOf(req) });
  const result = filterLocatorStations(stations, optionsFrom(req.query));
  const { offset, limit } = pageFrom(req.query, CHARGER_PAGE);
  const page = result.slice(offset, offset + limit);
  res.json({
    stations: page,
    count: result.length,
    total: result.length,
    offset,
    limit,
    hasMore: offset + page.length < result.length,
  });
});

locatorRouter.get('/stations/:id', async (req, res) => {
  const station = await rawPrisma.station.findUnique({ where: { id: req.params.id }, select: { tenantId: true } });
  const scope = scopeOf(req);
  if (!station || (scope && !scope.includes(station.tenantId))) {
    return res.status(404).json({ error: 'Charge point not found' });
  }
  const all = await publishedLocatorStations({ tenantIds: [station.tenantId] });
  const found = all.find((s) => s.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'Charge point not found' });
  res.json(found);
});

// One page of sites. `count` is the charge points across every matching site, and `total` the
// number of sites.
locatorRouter.get('/sites', async (req, res) => {
  const stations = await publishedLocatorStations({ tenantIds: scopeOf(req) });
  const result = filterLocatorStations(stations, optionsFrom(req.query));
  const sites = await sitesById([...new Set(result.map((s) => s.site.id))]);
  const all = groupBySite(result, sites);
  const { offset, limit } = pageFrom(req.query, SITE_PAGE);
  const page = all.slice(offset, offset + limit);
  res.json({
    sites: page,
    count: result.length,
    total: all.length,
    offset,
    limit,
    hasMore: offset + page.length < all.length,
  });
});
