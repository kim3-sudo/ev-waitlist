import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Button, List, ListItemButton, ListItemText, Stack, TextField, Typography, Box } from '@mui/material';
import { api } from '../../api/client.js';
import { TILE_URL, TILE_ATTRIBUTION } from './locatorFormat.js';

// Places the pin where the admin clicks, or where the pin is dragged to.
function ClickToPlace({ onPlace }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Moves the map to the pin when it is set from outside the map (an address lookup).
function Recentre({ latitude, longitude }) {
  const map = useMap();
  useEffect(() => {
    if (latitude == null || longitude == null) return;
    const here = map.getCenter();
    if (Math.abs(here.lat - latitude) > 1e-6 || Math.abs(here.lng - longitude) > 1e-6) {
      map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
    }
  }, [map, latitude, longitude]);
  return null;
}

// A map to set a latitude and longitude, with an address search (via the server's geocoder).
// `onPick` receives the coordinates and the address the lookup found, so the form can fill in blanks.
export function LocationPicker({ latitude, longitude, onChange, onPick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  const hasPin = latitude != null && latitude !== '' && longitude != null && longitude !== '';
  const center = hasPin ? [Number(latitude), Number(longitude)] : [51.5, -0.12];

  function place(lat, lng) {
    onChange({ latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) });
  }

  async function search() {
    const q = query.trim();
    if (q.length < 3) {
      setMessage('Enter at least 3 characters.');
      return;
    }
    setSearching(true);
    setMessage('');
    try {
      const res = await api.get('/api/admin/locator/geocode', { params: { q } });
      setResults(res.data.results);
      if (!res.data.results.length) setMessage('No matching address was found. Try another, or click the map.');
    } catch (err) {
      setMessage(err.response?.data?.error ?? 'The address lookup failed.');
    } finally {
      setSearching(false);
    }
  }

  function choose(result) {
    place(result.latitude, result.longitude);
    onPick?.(result);
    setResults([]);
    setMessage('');
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          label="Look up an address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          fullWidth
        />
        <Button variant="outlined" onClick={search} disabled={searching}>
          {searching ? 'Looking…' : 'Find'}
        </Button>
      </Stack>
      {message && (
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      )}
      {results.length > 0 && (
        <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 180, overflow: 'auto' }}>
          {results.map((r) => (
            <ListItemButton key={`${r.latitude},${r.longitude}`} onClick={() => choose(r)}>
              <ListItemText primary={r.label} />
            </ListItemButton>
          ))}
        </List>
      )}
      <Box sx={{ height: 260, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
        <MapContainer center={center} zoom={hasPin ? 15 : 10} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <ClickToPlace onPlace={place} />
          <Recentre latitude={hasPin ? Number(latitude) : null} longitude={hasPin ? Number(longitude) : null} />
          {hasPin && (
            <Marker
              position={center}
              draggable
              eventHandlers={{ dragend: (e) => place(e.target.getLatLng().lat, e.target.getLatLng().lng) }}
            />
          )}
        </MapContainer>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Click the map or drag the pin to set the position. Map data © OpenStreetMap contributors.
      </Typography>
    </Stack>
  );
}
