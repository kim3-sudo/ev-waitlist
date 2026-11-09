import { Chip, List, ListItem, ListItemButton, Stack, Typography } from '@mui/material';
import { STATE_INFO, formatDistance, formatKw, formatRate, standardName } from './locatorFormat.js';

// One charge point, as a row in the list views.
export function ChargerRow({ station, selected, onSelect }) {
  const state = STATE_INFO[station.state] ?? STATE_INFO.OFFLINE;
  const place = [station.address, station.city].filter(Boolean).join(', ');
  const distance = formatDistance(station.distanceKm);
  return (
    <ListItem disablePadding divider>
      <ListItemButton selected={selected} onClick={() => onSelect(station.id)} sx={{ alignItems: 'flex-start', py: 1.5 }}>
        <Stack spacing={0.75} sx={{ width: '100%', minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
              {station.name}
            </Typography>
            <Chip
              size="small"
              label={state.label}
              sx={{ bgcolor: state.color, color: '#fff', fontWeight: 600, flexShrink: 0 }}
            />
          </Stack>
          {place && (
            <Typography variant="body2" color="text.secondary">
              {place}
            </Typography>
          )}
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2">{formatKw(station.maxKw)}</Typography>
            {distance && <Typography variant="body2" color="text.secondary">· {distance} away</Typography>}
            <Typography variant="body2" color="text.secondary">· {formatRate(station.pricing)}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {station.connectors.map((c) => (
              <Chip key={c.connectorId} size="small" variant="outlined" label={`${standardName(c.standard)}${c.kw ? ` · ${c.kw} kW` : ''}`} />
            ))}
          </Stack>
        </Stack>
      </ListItemButton>
    </ListItem>
  );
}

export function ChargerList({ stations, selectedId, onSelect }) {
  if (!stations.length) return null;
  return (
    <List disablePadding sx={{ bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider', overflow: 'hidden' }}>
      {stations.map((s) => (
        <ChargerRow key={s.id} station={s} selected={s.id === selectedId} onSelect={onSelect} />
      ))}
    </List>
  );
}
