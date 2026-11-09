# Charger locator

The locator shows drivers your charge points as a map (the default), a list, or a by-site view. It's the home page: `/` for the default site and `/t/<slug>` for a named site. The old `/locator` addresses still work.

Drivers can filter by plug type, minimum power, availability, and text. They can sort by distance and open a charge point to see live status, price, hours, and directions. The button reads "Start charging" when a charger is free and nobody waits, and "Join waitlist" otherwise.

## Make a charge point appear

Add these details, or the locator hides the charge point:

- A latitude and longitude.
- For every connector: plug type, format, power type, voltage, and amperage.

A site appears in the by-site view when at least one charge point is listed. Set the site's address and pin under **Admin > Site location**.

## Set details

- **Address, hours, and nearby amenities.** Set them per charge point, or leave them blank to use the site's.
- **Address lookup.** The admin pin picker searches through the server, so the browser never calls the geocoder.
- **Power.** The server calculates it from voltage and amperage. Three-phase uses the square root of three.
- **Price.** The locator shows the price from your payment settings.

Set the site's nearby amenities, parking options, and access control on the Site location page. Set a charge point's parking options on its own form.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `GET /api/locator/stations` | Public | List or map charge points across all sites. See filters below. |
| `GET /api/locator/stations/:id` | Public | One charge point, with pricing and notices |
| `GET /api/locator/sites` | Public | Sites, grouped by zone, with the same filters |
| `GET`/`PUT /api/admin/locator/site` | Admin (stations) | Read or set the site's address and pin |
| `GET /api/admin/locator/geocode?q=` | Admin (stations) | Look up an address |
| `GET /api/t/<slug>/locator/...` | Public | Same as above, for one site |

**Filters** on the station and site lists: `q`, `standard` (plugs), `type` (`AC` or `DC`), `minChargers`, `amenities` and `parking` (all must match), `minKw`, `available=1`, `bbox=w,s,e,n`, `lat`, `lng`, `radiusKm`, and `sort=distance|power|name`. Separate multiple values with commas. Plugs and types match any one value.

**Paging:** send `offset` and `limit`. Charge points default to 25 per page, sites to 10, with a maximum of 500. The reply includes `count`, `total`, and `hasMore`. The map requests `bbox` with `limit=500`.

## Configure

- `VITE_TILE_URL`: your map tile server. Default: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- `NOMINATIM_URL`: your geocoder. Default: `https://nominatim.openstreetmap.org/search`. Lookups run at most once per second.

Before a busy public launch, use a commercial tile provider or host your own tiles, and set `VITE_TILE_URL`. Keep the "© OpenStreetMap contributors" attribution visible.

## Load demo data

Run `npm run db:seed-simulator` to place the simulator charge point on the map. It uses London by default, or set `SIM_LATITUDE` and `SIM_LONGITUDE`. Running it again fills only blank fields.

## Keys

Amenity, parking, and access keys live in `server/src/services/siteFeatures.js`. Keep `web/src/components/locator/locatorFormat.js` in sync with them.
