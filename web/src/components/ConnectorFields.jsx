import { Alert, ListSubheader, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import {
  CONNECTOR_FORMAT_OPTIONS,
  CONNECTOR_STANDARD_OPTIONS,
  POWER_TYPE_OPTIONS,
  optionFor,
} from '../connectorOptions.js';

// A select whose closed state shows the friendly name, and whose list shows the
// friendly name, the code the server stores (for example IEC_62196_T2), and the other
// names for the same connector. Options can be grouped by their `group`.
function OptionSelect({ label, value, onChange, options, grouped = false }) {
  const selected = optionFor(options, value);

  function items(list) {
    return list.map((o) => (
      <MenuItem key={o.value} value={o.value} sx={{ alignItems: 'flex-start', whiteSpace: 'normal', py: 1 }}>
        <Stack>
          <Typography variant="body2">{o.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[o.value, ...o.aliases].join(' · ')}
          </Typography>
          {o.note && (
            <Typography variant="caption" color="text.secondary">
              {o.note}
            </Typography>
          )}
        </Stack>
      </MenuItem>
    ));
  }

  let children;
  if (grouped) {
    const groups = [...new Set(options.map((o) => o.group))];
    children = groups.flatMap((group) => [
      <ListSubheader key={`group-${group}`}>{group}</ListSubheader>,
      ...items(options.filter((o) => o.group === group)),
    ]);
  } else {
    children = items(options);
  }

  return (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      sx={{ flex: 1, minWidth: 0 }}
      slotProps={{
        select: {
          renderValue: (v) => (v ? (selected?.name ?? v) : 'Not set'),
        },
      }}
    >
      <MenuItem value="">Not set</MenuItem>
      {children}
    </TextField>
  );
}

// The connector details for each connector on a charge point. Used by both the
// wizard and the full form. `details` is keyed by connector number.
export function ConnectorFields({ count, details, onChange, intro }) {
  const numbers = Array.from({ length: Math.max(0, Number(count) || 0) }, (_, i) => i + 1);
  if (numbers.length === 0) return null;

  return (
    <Stack spacing={1.5}>
      {intro && <Alert severity="info">{intro}</Alert>}
      {numbers.map((id) => {
        const d = details[id] ?? {};
        const set = (field) => (value) => onChange(id, field, value);
        return (
          <Paper key={id} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">Connector {id}</Typography>
              <OptionSelect
                label="Connector standard"
                value={d.standard ?? ''}
                onChange={set('standard')}
                options={CONNECTOR_STANDARD_OPTIONS}
                grouped
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <OptionSelect
                  label="Format"
                  value={d.format ?? ''}
                  onChange={set('format')}
                  options={CONNECTOR_FORMAT_OPTIONS}
                />
                <OptionSelect
                  label="Power type"
                  value={d.powerType ?? ''}
                  onChange={set('powerType')}
                  options={POWER_TYPE_OPTIONS}
                />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small"
                  label="Maximum volts"
                  type="number"
                  value={d.maxVoltage ?? ''}
                  onChange={(e) => onChange(id, 'maxVoltage', e.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 1000 } }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Maximum amps"
                  type="number"
                  value={d.maxAmperage ?? ''}
                  onChange={(e) => onChange(id, 'maxAmperage', e.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 1000 } }}
                  fullWidth
                />
              </Stack>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

