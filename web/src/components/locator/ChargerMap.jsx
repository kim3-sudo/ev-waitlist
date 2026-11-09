import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Stack, Typography } from '@mui/material';
import { CHARGER_TYPE_INFO, STATE_INFO, TILE_URL, TILE_ATTRIBUTION, formatKw, standardName } from './locatorFormat.js';

// Frames the map around the charge points once for each set of filters (`frameKey`). Later
// refreshes and pans leave the view where the driver put it.
function FitToStations({ stations, frameKey }) {
  const map = useMap();
  const framedFor = useRef(null);
  useEffect(() => {
    if (!stations.length || framedFor.current === frameKey) return;
    framedFor.current = frameKey;
    const bounds = stations.map((s) => [s.latitude, s.longitude]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, stations, frameKey]);
  return null;
}

// Reports the area on screen after the map settles, so only the charge points there are loaded.
function ViewportWatcher({ onViewport }) {
  const latest = useRef(onViewport);
  latest.current = onViewport;
  const timer = useRef(null);
  useMapEvents({
    moveend(e) {
      clearTimeout(timer.current);
      const map = e.target;
      timer.current = setTimeout(() => {
        const b = map.getBounds();
        latest.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(','));
      }, 300);
    },
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}

// A colour key for the two kinds of charge point on the map.
function Legend() {
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {Object.entries(CHARGER_TYPE_INFO).map(([type, info]) => (
        <Stack key={type} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: info.color }} />
          <Typography variant="body2">{info.label}</Typography>
        </Stack>
      ))}
      <Typography variant="body2" color="text.secondary">
        Faded points are offline.
      </Typography>
    </Stack>
  );
}

// Map of charge points. Colour says whether a charge point is DC rapid or Level 1/2 (AC);
// selecting one opens its detail.
// `stations` are the charge points in view (or all of them, before the map is framed). `total`
// is how many match in all, so the map can say when some are left off.
export function ChargerMap({ stations, total, selectedId, onSelect, userPosition, frameKey, onViewport }) {
  const center = stations[0] ? [stations[0].latitude, stations[0].longitude] : [51.5, -0.12];
  const left = Math.max(0, total - stations.length);

  return (
    <Stack spacing={1}>
      <Legend />
      <Box sx={{ height: { xs: '60vh', md: '70vh' }, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <FitToStations stations={stations} frameKey={frameKey} />
          <ViewportWatcher onViewport={onViewport} />
          {stations.map((s) => {
            const type = CHARGER_TYPE_INFO[s.chargerType] ?? CHARGER_TYPE_INFO.AC;
            const state = STATE_INFO[s.state] ?? STATE_INFO.OFFLINE;
            const selected = s.id === selectedId;
            const offline = s.state === 'OFFLINE';
            return (
              <CircleMarker
                key={s.id}
                center={[s.latitude, s.longitude]}
                radius={selected ? 11 : 8}
                pathOptions={{
                  color: selected ? '#212121' : '#ffffff',
                  weight: 2,
                  fillColor: type.color,
                  fillOpacity: offline ? 0.35 : 0.95,
                }}
                eventHandlers={{ click: () => onSelect(s.id) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <Box component="span" sx={{ display: 'block' }}>
                    <strong>{s.name}</strong> · {state.label}
                    <br />
                    {type.label} · {formatKw(s.maxKw)} · {s.connectors.map((c) => standardName(c.standard)).join(', ')}
                  </Box>
                </Tooltip>
              </CircleMarker>
            );
          })}
          {userPosition && (
            <CircleMarker
              center={[userPosition.lat, userPosition.lng]}
              radius={6}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#1976d2', fillOpacity: 1 }}
            >
              <Tooltip>You are here</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
        {!stations.length && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No charge points match these filters.
          </Typography>
        )}
      </Box>
      {left > 0 && (
        <Typography variant="body2" color="text.secondary">
          Showing {stations.length} of {total} charge points in view. Zoom in to see the rest.
        </Typography>
      )}
    </Stack>
  );
}
