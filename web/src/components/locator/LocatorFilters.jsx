import { Button, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { CONNECTOR_STANDARD_OPTIONS } from '../../connectorOptions.js';

const SORTS = [
  { value: 'distance', label: 'Nearest' },
  { value: 'power', label: 'Most power' },
  { value: 'name', label: 'Name' },
];

// The search and filter controls. The parent owns the values and the URL they live in.
export function LocatorFilters({ filters, onChange, locating, onNearMe, nearMeActive }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
        <TextField
          size="small"
          label="Search by name or address"
          value={filters.q}
          onChange={set('q')}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant={nearMeActive ? 'contained' : 'outlined'}
          startIcon={<MyLocationIcon />}
          onClick={onNearMe}
          disabled={locating}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {locating ? 'Finding you…' : nearMeActive ? 'Showing nearby' : 'Near me'}
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
        <TextField select size="small" label="Plug" value={filters.standard} onChange={set('standard')} sx={{ minWidth: 200 }}>
          <MenuItem value="">Any plug</MenuItem>
          {CONNECTOR_STANDARD_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="number"
          label="Minimum kW"
          value={filters.minKw}
          onChange={set('minKw')}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
          sx={{ width: 140 }}
        />
        <TextField select size="small" label="Sort by" value={filters.sort} onChange={set('sort')} sx={{ minWidth: 150 }}>
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              checked={filters.available}
              onChange={(e) => onChange({ ...filters, available: e.target.checked })}
            />
          }
          label="Free now"
        />
      </Stack>
    </Stack>
  );
}
