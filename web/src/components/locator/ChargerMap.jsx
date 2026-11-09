import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Typography } from '@mui/material';
import { STATE_INFO, TILE_URL, TILE_ATTRIBUTION, formatKw, standardName } from './locatorFormat.js';

// Keeps the map framed around the charge points when the list of them changes.
function FitToStations({ stations }) {
  const map = useMap();
  useEffect(() => {
    if (!stations.length) return;
    const bounds = stations.map((s) => [s.latitude, s.longitude]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, stations]);
  return null;
}

// Map of charge points. Markers are coloured by state, and selecting one opens its detail.
export function ChargerMap({ stations, selectedId, onSelect, userPosition }) {
  const center = stations[0] ? [stations[0].latitude, stations[0].longitude] : [51.5, -0.12];

  return (
    <Box sx={{ height: { xs: '60vh', md: '70vh' }, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FitToStations stations={stations} />
        {stations.map((s) => {
          const state = STATE_INFO[s.state] ?? STATE_INFO.OFFLINE;
          const selected = s.id === selectedId;
          return (
            <CircleMarker
              key={s.id}
              center={[s.latitude, s.longitude]}
              radius={selected ? 11 : 8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: state.color, fillOpacity: 0.95 }}
              eventHandlers={{ click: () => onSelect(s.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <Box component="span" sx={{ display: 'block' }}>
                  <strong>{s.name}</strong> · {state.label}
                  <br />
                  {formatKw(s.maxKw)} · {s.connectors.map((c) => standardName(c.standard)).join(', ')}
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
  );
}
