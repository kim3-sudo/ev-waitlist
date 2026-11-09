import { Router } from 'express';
import { rawPrisma } from '../db.js';
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
  if (typeof query.standard === 'string' && query.standard) options.standard = query.standard;
  const minKw = Number(query.minKw);
  if (query.minKw !== undefined && Number.isFinite(minKw) && minKw > 0) options.minKw = minKw;
  options.availableOnly = query.available === '1' || query.available === 'true';
  if (['distance', 'power', 'name'].includes(query.sort)) options.sort = query.sort;
  return options;
}

// The sites this request covers: one for a site route, every site otherwise.
function scopeOf(req) {
  return req.tenantId ? [req.tenantId] : null;
}

locatorRouter.get('/stations', async (req, res) => {
  const stations = await publishedLocatorStations({ tenantIds: scopeOf(req) });
  const result = filterLocatorStations(stations, optionsFrom(req.query));
  res.json({ stations: result, count: result.length });
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

locatorRouter.get('/sites', async (req, res) => {
  const stations = await publishedLocatorStations({ tenantIds: scopeOf(req) });
  const result = filterLocatorStations(stations, optionsFrom(req.query));
  const sites = await sitesById([...new Set(result.map((s) => s.site.id))]);
  res.json({ sites: groupBySite(result, sites) });
});
