# Charger locator

The charger locator shows drivers where their charge points are: as a list, grouped by
site (and zone), or as points on an OpenStreetMap map. The map is the default view. DC rapid
charge points and Level 1/2 (AC) charge points have different colours on the map. Drivers can
filter by one or more plug types (a charge point matches when it has any of them), minimum
power, availability and text, sort by distance, and open a charge point to see live connector
status, price, opening hours and directions.

The locator is the home page: `/` for the default site and `/t/<slug>` for a named site. It is
also where drivers join a waitlist or start charging. The detail panel's button reads "Start
charging" when nobody is waiting and a charger is free, and "Join waitlist" otherwise. The old
`/locator` and `/t/<slug>/locator` addresses still open the same page.

## What a charge point needs to appear

A charge point is shown only when it is publishable, the same rule the roaming feed uses:

- It has a latitude and longitude.
- Every connector has its plug type, format, power type, voltage and amperage.

A site (tenant) is shown on the by-site view when at least one of its charge points is
publishable. Its own address and pin are set under **Admin > Site location**.

## Where the details come from

- **Address, city, postal code, country, opening hours, nearby amenities.** A charge point
  can set its own. A blank value falls back to the site's.
- **Address lookup.** The admin pin picker searches with Nominatim, through the server
  (`GET /api/admin/locator/geocode`), so the browser never calls it directly.
- **Power.** Worked out from each connector's voltage and amperage (three-phase uses the
  square root of three).
- **Price.** The site's payment settings, as a driver sees them.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `GET /api/locator/stations` | public | List and map points, across all sites. Filters: `q`, `standard` (plugs), `type` (`AC`, `DC`), `minChargers` (charge points at the site, at least), `amenities` and `parking` (keys, all must match), `minKw`, `available=1`, `bbox=w,s,e,n`, `lat`, `lng`, `radiusKm`, `sort=distance\|power\|name`. Lists are comma-separated; plugs and types match any one, amenities and parking must all match. Each charge point carries `chargerType` (`DC` or `AC`), `waitingCount`, `tips`, and its `zone` with `waitingCount` and `available` |
| `GET /api/locator/stations/:id` | public | One charge point, with pricing and notices |
| `GET /api/locator/sites` | public | Sites, grouped by zone, with the same filters |
| `GET /api/t/<slug>/locator/...` | public | The same, for one site |
| `GET`/`PUT /api/admin/locator/site` | admin, stations view/manage | The site's own address and pin |
| `GET /api/admin/locator/geocode?q=` | admin, stations view | Address lookup |

## Configuration

- `VITE_TILE_URL`: the map tile server, when the default OpenStreetMap tiles are not used.
  Its default is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- `NOMINATIM_URL`: the geocoder for address lookups. Default
  `https://nominatim.openstreetmap.org/search`. Lookups are limited to one per second.

## Tile and geocoder policy

The public OpenStreetMap tile servers and Nominatim are shared services with usage
policies. They are fine for light use. Before a busy public launch, use a tile provider
or self-host tiles and point `VITE_TILE_URL` at it. The map always shows the
"© OpenStreetMap contributors" attribution, and that must stay visible.

## Demo data

`npm run db:seed-simulator` gives the simulator station a position (London by default,
or `SIM_LATITUDE` and `SIM_LONGITUDE`) and complete connector details, so it appears on
the map. Running it again only fills in blanks.

## Site details and parking

Each site has an admin-ticked list of amenities nearby (dining, restrooms, shopping, lodging,
public parks, grocery, Wi-Fi, camping, free charging), a list of parking options (accessible,
covered by a canopy, in a garage, illuminated, pull-through for trailers, trailer-friendly), and
an access-controlled flag for sites that need permission to enter, such as a workplace lot. The
admin sets these on the Site location page. A charge point has its own parking list, set on its
form. A driver sees the site's details in the charge point panel. Parking matches a filter when
the charge point or its site offers it. The keys are in `server/src/services/siteFeatures.js`,
and the web app keeps the same keys in `web/src/components/locator/locatorFormat.js`.
