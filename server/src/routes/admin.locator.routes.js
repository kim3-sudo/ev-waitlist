import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { coordinatesProblem, cleanText, locatorTextFields } from '../services/locator.js';
import { normalizeAmenityKeys, normalizeParkingKeys, siteFeaturesView } from '../services/siteFeatures.js';

// Admin tools for the charger locator: the site's own address and pin, and an
// address lookup. Mounted behind stations view/manage (see app.js).
export const adminLocatorRouter = Router();

// Nominatim is the OpenStreetMap geocoder. Its usage policy asks for an identifying
// User-Agent and at most one request per second, so lookups go through here.
const NOMINATIM_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Plugyard charger locator';
const MIN_INTERVAL_MS = 1000;
let lastLookup = 0;

async function lookupAddress(query) {
  const wait = lastLookup + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastLookup = Date.now();
  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error(`Address lookup failed (${response.status})`);
  const rows = await response.json();
  return rows.map((row) => ({
    label: row.display_name,
    latitude: Number(row.lat),
    longitude: Number(row.lon),
    address: row.address ?? {},
  }));
}

function siteLocationView(site) {
  return {
    address: site.address,
    city: site.city,
    postalCode: site.postalCode,
    country: site.country,
    latitude: site.latitude,
    longitude: site.longitude,
    hours: site.hours,
    amenities: site.amenities,
    amenityKeys: siteFeaturesView(site).amenities,
    parkingKeys: siteFeaturesView(site).parking,
    accessControlled: Boolean(site.accessControlled),
  };
}

adminLocatorRouter.get('/site', async (req, res) => {
  const site = await rawPrisma.tenant.findUnique({ where: { id: currentTenantId() } });
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(siteLocationView(site));
});

adminLocatorRouter.put('/site', async (req, res) => {
  const body = req.body ?? {};
  const coords = coordinatesProblem(body.latitude, body.longitude);
  if (coords) return res.status(400).json({ error: coords });
  const address = cleanText(body.address, 'Address');
  if (address.error) return res.status(400).json({ error: address.error });
  const text = locatorTextFields(body);
  if (text.error) return res.status(400).json({ error: text.error });
  const amenities = normalizeAmenityKeys(body.amenityKeys);
  if (amenities.error) return res.status(400).json({ error: amenities.error });
  const parking = normalizeParkingKeys(body.parkingKeys);
  if (parking.error) return res.status(400).json({ error: parking.error });
  if (body.accessControlled !== undefined && typeof body.accessControlled !== 'boolean') {
    return res.status(400).json({ error: 'accessControlled must be true or false' });
  }

  const data = {
    ...text.fields,
    ...(amenities.value !== undefined && { amenityKeys: amenities.value }),
    ...(parking.value !== undefined && { parkingKeys: parking.value }),
    ...(body.accessControlled !== undefined && { accessControlled: body.accessControlled }),
    ...(address.value !== undefined && { address: address.value }),
    ...(body.latitude !== undefined && { latitude: body.latitude === '' ? null : body.latitude }),
    ...(body.longitude !== undefined && { longitude: body.longitude === '' ? null : body.longitude }),
  };
  const updated = await rawPrisma.tenant.update({ where: { id: currentTenantId() }, data });
  res.json(siteLocationView(updated));
});

// Looks up an address and returns candidate coordinates, for the pin picker.
adminLocatorRouter.get('/geocode', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 3) return res.status(400).json({ error: 'Enter at least 3 characters to look up' });
  if (q.length > 200) return res.status(400).json({ error: 'Address lookups are limited to 200 characters' });
  try {
    res.json({ results: await lookupAddress(q) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
