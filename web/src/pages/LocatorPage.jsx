import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Container, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { LocatorFilters } from '../components/locator/LocatorFilters.jsx';
import { ChargerList } from '../components/locator/ChargerList.jsx';
import { SiteList } from '../components/locator/SiteList.jsx';
import { ChargerDetailDrawer } from '../components/locator/ChargerDetailDrawer.jsx';
import { ChargerMap } from '../components/locator/ChargerMap.jsx';

// The charger locator: the same stations as a list, grouped by site, or as points on a map.
// Filters and the chosen view live in the address, so a link reopens the same search.
const VIEWS = ['list', 'sites', 'map'];

function filtersFrom(params) {
  return {
    q: params.get('q') ?? '',
    standard: params.get('standard') ?? '',
    minKw: params.get('minKw') ?? '',
    available: params.get('available') === '1',
    sort: params.get('sort') ?? 'distance',
  };
}

export function LocatorPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'list';
  const filters = useMemo(() => filtersFrom(params), [params]);
  const selectedId = params.get('station');

  const [nearMe, setNearMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [data, setData] = useState({ stations: [], sites: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Writes one or more settings into the address. Empty values are dropped.
  const update = useCallback(
    (changes) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === '' || value === false || value == null) next.delete(key);
            else next.set(key, value === true ? '1' : String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const changeFilters = (next) =>
    update({ q: next.q, standard: next.standard, minKw: next.minKw, available: next.available, sort: next.sort });

  function nearMeClick() {
    if (nearMe) {
      setNearMe(null);
      return;
    }
    if (!navigator.geolocation) {
      setLocationError('Your browser cannot share its location.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        update({ sort: 'distance' });
      },
      () => {
        setLocationError('We could not find your location. Check the browser permission and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  // Refetches whenever a filter, the view, or the location changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const query = {
      ...(filters.q && { q: filters.q }),
      ...(filters.standard && { standard: filters.standard }),
      ...(filters.minKw && { minKw: filters.minKw }),
      ...(filters.available && { available: 1 }),
      ...(filters.sort && { sort: filters.sort }),
      ...(nearMe && { lat: nearMe.lat, lng: nearMe.lng }),
    };
    const path = view === 'sites' ? '/api/locator/sites' : '/api/locator/stations';
    api
      .get(path, { params: query })
      .then((res) => {
        if (cancelled) return;
        setData({
          stations: res.data.stations ?? [],
          sites: res.data.sites ?? [],
        });
      })
      .catch(() => !cancelled && setLoadError('Charge points could not be loaded. Try again in a moment.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, filters, nearMe]);

  const select = (id) => update({ station: id });
  const count = view === 'sites' ? data.sites.reduce((total, site) => total + site.chargerCount, 0) : data.stations.length;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
          <div>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
              Find a charger
            </Typography>
            <Typography color="text.secondary">
              {loading ? 'Looking…' : `${count} charge point${count === 1 ? '' : 's'}`}
            </Typography>
          </div>
          <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next) => next && update({ view: next })}>
            <ToggleButton value="list">List</ToggleButton>
            <ToggleButton value="sites">By site</ToggleButton>
            <ToggleButton value="map">Map</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <LocatorFilters
          filters={filters}
          onChange={changeFilters}
          locating={locating}
          onNearMe={nearMeClick}
          nearMeActive={Boolean(nearMe)}
        />

        {locationError && <Alert severity="warning" onClose={() => setLocationError(null)}>{locationError}</Alert>}
        {loadError && <Alert severity="error">{loadError}</Alert>}

        {view === 'list' && !loading && !count && !loadError && (
          <Typography color="text.secondary">No charge points match these filters.</Typography>
        )}
        {view === 'list' && <ChargerList stations={data.stations} selectedId={selectedId} onSelect={select} />}

        {view === 'sites' && !loading && !data.sites.length && !loadError && (
          <Typography color="text.secondary">No sites have charge points to show yet.</Typography>
        )}
        {view === 'sites' && <SiteList sites={data.sites} selectedId={selectedId} onSelect={select} />}

        {view === 'map' && (
          <ChargerMap
            stations={data.stations}
            selectedId={selectedId}
            onSelect={select}
            userPosition={nearMe}
          />
        )}
      </Stack>

      <ChargerDetailDrawer stationId={selectedId} onClose={() => update({ station: null })} />
    </Container>
  );
}
