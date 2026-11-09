import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api/client.js';
import { LocatorFilters, activeFilterCount } from '../components/locator/LocatorFilters.jsx';
import { ChargerList } from '../components/locator/ChargerList.jsx';
import { SiteList } from '../components/locator/SiteList.jsx';
import { ChargerDetailDrawer } from '../components/locator/ChargerDetailDrawer.jsx';
import { ChargerMap } from '../components/locator/ChargerMap.jsx';
import { LoadMore } from '../components/locator/LoadMore.jsx';
import { usePagedLocator } from '../components/locator/usePagedLocator.js';
import { WaitlistJoinDialog } from '../components/WaitlistJoinDialog.jsx';
import { WaitlistStatusCard } from '../components/WaitlistStatusCard.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { SiteNotices } from '../components/DriverNotices.jsx';

// The charger locator is the home page: the same stations as a map, a list, or grouped by site.
// A driver joins a waitlist or starts charging from a charge point's detail. Filters and the
// chosen view live in the address, so a link reopens the same search.
const VIEWS = ['map', 'list', 'sites'];
const POLL_MS = 15000;
const MY_ENTRIES_KEY = 'myWaitlistEntries';
// How many charge points or sites each page of the list shows, and the most the map draws.
const CHARGER_PAGE = 25;
const SITE_PAGE = 10;
const MAP_LIMIT = 500;

// Each list filter is stored in the address as comma-separated keys.
const listOf = (params, key) => params.get(key)?.split(',').filter(Boolean) ?? [];

function filtersFrom(params) {
  return {
    q: params.get('q') ?? '',
    standard: listOf(params, 'standard'),
    types: listOf(params, 'type'),
    minKw: params.get('minKw') ?? '',
    minChargers: params.get('minChargers') ?? '',
    amenities: listOf(params, 'amenities'),
    parking: listOf(params, 'parking'),
    available: params.get('available') === '1',
    sort: params.get('sort') ?? 'distance',
  };
}

const NO_FILTERS = {
  q: '',
  standard: [],
  types: [],
  minKw: '',
  minChargers: '',
  amenities: [],
  parking: [],
  available: false,
};

function loadMyEntries() {
  try {
    return JSON.parse(localStorage.getItem(MY_ENTRIES_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveMyEntries(entries) {
  try {
    localStorage.setItem(MY_ENTRIES_KEY, JSON.stringify(entries));
  } catch {
    // Storage may be blocked; the entries still show for this visit.
  }
}

// The search above the list and by-site views. It waits for a pause in typing before it
// searches, so each keystroke does not ask the server again. It follows the address when the
// search changes elsewhere, such as Clear all in the filters.
function SearchBox({ value, onSearch, placeholder }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const timer = setTimeout(() => onSearch(text), 300);
    return () => clearTimeout(timer);
    // Only typing starts the wait. A change from the address is not sent back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <TextField
      size="small"
      fullWidth
      placeholder={placeholder}
      aria-label={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export function LocatorPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'map';
  const filters = useMemo(() => filtersFrom(params), [params]);
  const selectedId = params.get('station');

  const [nearMe, setNearMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [notices, setNotices] = useState({ alerts: [], pricing: [], paymentOutage: null });

  // The driver's own waitlist entries, and what happened when each was made this visit.
  const [myEntries, setMyEntries] = useState(loadMyEntries);
  const [joinNotes, setJoinNotes] = useState({});
  const [joinTarget, setJoinTarget] = useState(null);
  // The filters sit in a panel, so the list and the map have the room.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A signed-in driver's vehicles, and the plugs they can charge with between them.
  const { can } = useAuth();
  const canDrive = can('driver.account');
  const [vehiclePlugs, setVehiclePlugs] = useState([]);
  useEffect(() => {
    if (!canDrive) return;
    api
      .get('/api/driver/vehicles')
      .then(({ data }) => setVehiclePlugs([...new Set(data.flatMap((v) => v.plugs))]))
      .catch(() => setVehiclePlugs([]));
  }, [canDrive]);
  // While payment is down in lockout mode, nobody can join.
  const lockedOut = notices.paymentOutage?.mode === 'LOCKOUT';

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
    update({
      q: next.q,
      standard: next.standard.join(','),
      type: next.types.join(','),
      minKw: next.minKw,
      minChargers: next.minChargers,
      amenities: next.amenities.join(','),
      parking: next.parking.join(','),
      available: next.available,
      sort: next.sort,
    });

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

  // The filters as the server takes them.
  const filterQuery = useMemo(
    () => ({
      ...(filters.q && { q: filters.q }),
      ...(filters.standard.length && { standard: filters.standard.join(',') }),
      ...(filters.types.length && { type: filters.types.join(',') }),
      ...(filters.minKw && { minKw: filters.minKw }),
      ...(filters.minChargers && { minChargers: filters.minChargers }),
      ...(filters.amenities.length && { amenities: filters.amenities.join(',') }),
      ...(filters.parking.length && { parking: filters.parking.join(',') }),
      ...(filters.available && { available: 1 }),
      ...(filters.sort && { sort: filters.sort }),
      ...(nearMe && { lat: nearMe.lat, lng: nearMe.lng }),
    }),
    [filters, nearMe],
  );

  // A new view or new filters start the results again from the top.
  const resetKey = `${view}|${JSON.stringify(filterQuery)}`;

  // The map asks only for the charge points in the area on screen. The box is kept against the
  // filters it was drawn for, so a change of filters asks for everything again, and the map
  // frames the new results.
  const [mapView, setMapView] = useState(null);
  const onViewport = useCallback((bbox) => setMapView({ key: resetKey, bbox }), [resetKey]);
  const isMap = view === 'map';
  const isSites = view === 'sites';
  const mapBbox = isMap && mapView?.key === resetKey ? mapView.bbox : null;

  const { items, count, hasMore, loading, loadingMore, error, loadMore, total } = usePagedLocator({
    path: isSites ? '/api/locator/sites' : '/api/locator/stations',
    itemsKey: isSites ? 'sites' : 'stations',
    query: mapBbox ? { ...filterQuery, bbox: mapBbox } : filterQuery,
    pageSize: isMap ? MAP_LIMIT : isSites ? SITE_PAGE : CHARGER_PAGE,
    resetKey,
  });

  // Site-wide alerts, price changes and payment status.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get('/api/notices')
        .then((res) => !cancelled && setNotices(res.data))
        .catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function handleJoined({ entryId, ...notes }) {
    const next = [...myEntries, entryId];
    setMyEntries(next);
    saveMyEntries(next);
    setJoinNotes((prev) => ({ ...prev, [entryId]: notes }));
    setJoinTarget(null);
  }

  function handleLeave(entryId) {
    const next = myEntries.filter((id) => id !== entryId);
    setMyEntries(next);
    saveMyEntries(next);
  }

  const select = (id) => update({ station: id });
  const activeCount = activeFilterCount(filters);
  const filterControls = (
    <LocatorFilters
      filters={filters}
      onChange={changeFilters}
      locating={locating}
      onNearMe={nearMeClick}
      nearMeActive={Boolean(nearMe)}
      vertical
      vehiclePlugs={vehiclePlugs}
      onUseVehiclePlugs={() => changeFilters({ ...filters, standard: vehiclePlugs })}
    />
  );

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {myEntries.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Your waitlist status
          </Typography>
          <Stack spacing={1}>
            {myEntries.map((entryId) => (
              <WaitlistStatusCard key={entryId} entryId={entryId} onLeave={handleLeave} initial={joinNotes[entryId]} />
            ))}
          </Stack>
        </Box>
      )}

      <SiteNotices alerts={notices.alerts} pricing={notices.pricing} paymentOutage={notices.paymentOutage} />

      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
          <div>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
              Find a charger
            </Typography>
            <Typography color="text.secondary">
              {loading && !count
                ? 'Looking…'
                : `${count} charge point${count === 1 ? '' : 's'}${isMap ? ' in view' : ''}`}
            </Typography>
          </div>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next) => next && update({ view: next })}>
              <ToggleButton value="map">Map</ToggleButton>
              <ToggleButton value="list">List</ToggleButton>
              <ToggleButton value="sites">By site</ToggleButton>
            </ToggleButtonGroup>
            <Badge badgeContent={activeCount} color="primary" overlap="circular">
              <Button variant="outlined" size="small" startIcon={<FilterListIcon />} onClick={() => setFiltersOpen(true)}>
                Filters
              </Button>
            </Badge>
          </Stack>
        </Stack>

        {locationError && <Alert severity="warning" onClose={() => setLocationError(null)}>{locationError}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}

        {!isMap && (
          <SearchBox
            value={filters.q}
            onSearch={(q) => update({ q })}
            placeholder={isSites ? 'Search sites, charge points or addresses' : 'Search by name or address'}
          />
        )}

        {view === 'list' && !loading && !count && !error && (
          <Typography color="text.secondary">No charge points match these filters.</Typography>
        )}
        {view === 'list' && (
          <>
            <ChargerList stations={items} selectedId={selectedId} onSelect={select} />
            {items.length > 0 && (
              <LoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} shown={items.length} total={total} noun="charge points" />
            )}
          </>
        )}

        {isSites && !loading && !count && !error && (
          <Typography color="text.secondary">No sites have charge points to show yet.</Typography>
        )}
        {isSites && (
          <>
            <SiteList sites={items} selectedId={selectedId} onSelect={select} />
            {items.length > 0 && (
              <LoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} shown={items.length} total={total} noun="sites" />
            )}
          </>
        )}

        {isMap && (
          <ChargerMap
            stations={items}
            total={count}
            selectedId={selectedId}
            onSelect={select}
            userPosition={nearMe}
            frameKey={resetKey}
            onViewport={onViewport}
          />
        )}
      </Stack>

      <Drawer
        anchor="left"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 380 }, p: 2.5 } } }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Filters
          </Typography>
          <IconButton onClick={() => setFiltersOpen(false)} aria-label="Close filters">
            <CloseIcon />
          </IconButton>
        </Stack>
        <Stack spacing={2.5} sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {filterControls}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ pt: 2, justifyContent: 'space-between' }}>
          <Button disabled={!activeCount} onClick={() => changeFilters({ ...NO_FILTERS, sort: filters.sort })}>
            Clear all
          </Button>
          <Button variant="contained" onClick={() => setFiltersOpen(false)}>
            {isMap ? 'Done' : `Show ${count} charge point${count === 1 ? '' : 's'}`}
          </Button>
        </Stack>
      </Drawer>

      <ChargerDetailDrawer
        stationId={selectedId}
        onClose={() => update({ station: null })}
        onJoin={setJoinTarget}
        lockedOut={lockedOut}
      />

      {joinTarget && (
        <WaitlistJoinDialog
          target={joinTarget}
          mode={joinTarget.mode}
          onClose={() => setJoinTarget(null)}
          onJoined={handleJoined}
        />
      )}
    </Container>
  );
}
