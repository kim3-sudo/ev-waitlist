import { Checkbox, FormControlLabel, FormGroup, FormLabel, Stack } from '@mui/material';

// A set of ticked options, for the admin forms. `value` and `onChange` work with a list of keys.
export function FeatureCheckboxes({ legend, options, value, onChange, helperText }) {
  const toggle = (key) => (e) =>
    onChange(e.target.checked ? [...value, key] : value.filter((k) => k !== key));
  return (
    <Stack spacing={0.5}>
      <FormLabel component="legend" sx={{ typography: 'subtitle2' }}>
        {legend}
      </FormLabel>
      {helperText && (
        <FormLabel component="legend" sx={{ typography: 'caption' }}>
          {helperText}
        </FormLabel>
      )}
      <FormGroup sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        {options.map((o) => (
          <FormControlLabel
            key={o.key}
            control={<Checkbox checked={value.includes(o.key)} onChange={toggle(o.key)} />}
            label={o.label}
          />
        ))}
      </FormGroup>
    </Stack>
  );
}
