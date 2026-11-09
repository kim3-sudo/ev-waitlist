import {
  Button,
  Checkbox,
  FormControlLabel,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { CONNECTOR_STANDARD_OPTIONS } from '../../connectorOptions.js';
import { AMENITY_OPTIONS, PARKING_OPTIONS } from './locatorFormat.js';

const SORTS = [
  { value: 'distance', label: 'Nearest' },
  { value: 'power', label: 'Most power' },
  { value: 'name', label: 'Name' },
];

const CHARGER_TYPES = [
  { value: 'AC', label: 'Level 1/2 (AC)' },
  { value: 'DC', label: 'DC rapid' },
];

// A menu where several options can be ticked. The label stays above the chosen names.
function MultiSelect({ label, options, value, onChange, emptyText, width = 240 }) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: width }}
      slotProps={{
        inputLabel: { shrink: true },
        select: {
          multiple: true,
          displayEmpty: true,
          renderValue: (selected) => (selected.length ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') : emptyText),
        },
      }}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          <Checkbox size="small" checked={value.includes(o.value)} sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={o.label} />
        </MenuItem>
      ))}
    </TextField>
  );
}

// How many filters are narrowing the list. Shown on the Filters button.
export function activeFilterCount(filters) {
  return (
    (filters.q ? 1 : 0) +
    filters.standard.length +
    filters.types.length +
    (filters.minKw ? 1 : 0) +
    (filters.minChargers ? 1 : 0) +
    filters.amenities.length +
    filters.parking.length +
    (filters.available ? 1 : 0)
  );
}

// The search and filter controls. The parent owns the values and the URL they live in.
// Several options in one filter: a charge point matches when it has any of the chosen plugs
// or charger types, and when it has all of the chosen amenities and parking.
// `vertical` stacks the controls, for the filters panel on the map.
export function LocatorFilters({ filters, onChange, locating, onNearMe, nearMeActive, vertical = false, vehiclePlugs = [], onUseVehiclePlugs }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  const direction = vertical ? 'column' : { xs: 'column', md: 'row' };

  return (
    <Stack spacing={1.5}>
      <Stack direction={direction} spacing={1.5} sx={{ alignItems: vertical ? 'stretch' : { md: 'center' }, flexWrap: 'wrap' }}>
        <TextField size="small" label="Search by name or address" value={filters.q} onChange={set('q')} sx={{ flexGrow: 1 }} />
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

      <Stack direction={direction} spacing={1.5} sx={{ alignItems: vertical ? 'stretch' : { md: 'center' }, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          size="small"
          aria-label="Charger type"
          value={filters.types}
          onChange={(_, next) => onChange({ ...filters, types: next })}
        >
          {CHARGER_TYPES.map((t) => (
            <ToggleButton key={t.value} value={t.value} sx={{ textTransform: 'none', px: 1.5 }}>
              {t.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <MultiSelect
          label="Plugs"
          options={CONNECTOR_STANDARD_OPTIONS.map((o) => ({ value: o.value, label: o.name }))}
          value={filters.standard}
          onChange={(next) => onChange({ ...filters, standard: next })}
          emptyText="Any plug"
        />
        {onUseVehiclePlugs && vehiclePlugs.length > 0 && (
          <Button size="small" variant="text" onClick={onUseVehiclePlugs} sx={{ whiteSpace: 'nowrap' }}>
            Use my vehicles&apos; plugs
          </Button>
        )}
      </Stack>

      <Stack direction={direction} spacing={1.5} sx={{ alignItems: vertical ? 'stretch' : { md: 'center' }, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          type="number"
          label="Minimum kW"
          value={filters.minKw}
          onChange={set('minKw')}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
          sx={{ width: vertical ? '100%' : 140 }}
        />
        <TextField
          size="small"
          type="number"
          label="Chargers at the site, at least"
          helperText="Counts the charge points at the same site"
          value={filters.minChargers}
          onChange={set('minChargers')}
          slotProps={{ htmlInput: { min: 1, step: 1 }, inputLabel: { shrink: true } }}
          sx={{ width: vertical ? '100%' : 220 }}
        />
        <MultiSelect
          label="Site amenities"
          options={AMENITY_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          value={filters.amenities}
          onChange={(next) => onChange({ ...filters, amenities: next })}
          emptyText="Any amenity"
          width={vertical ? 300 : 240}
        />
        <MultiSelect
          label="Parking"
          options={PARKING_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          value={filters.parking}
          onChange={(next) => onChange({ ...filters, parking: next })}
          emptyText="Any parking"
          width={vertical ? 300 : 240}
        />
      </Stack>

      <Stack direction={direction} spacing={1.5} sx={{ alignItems: vertical ? 'stretch' : { md: 'center' }, flexWrap: 'wrap' }}>
        <TextField select size="small" label="Sort by" value={filters.sort} onChange={set('sort')} sx={{ minWidth: 150 }}>
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={filters.available} onChange={(e) => onChange({ ...filters, available: e.target.checked })} />}
          label="Free now"
        />
      </Stack>
    </Stack>
  );
}
