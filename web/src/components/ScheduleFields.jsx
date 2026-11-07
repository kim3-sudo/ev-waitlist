import { Stack, TextField } from '@mui/material';

// Converts a time (Date or ISO text) to the value a datetime-local input shows, in local time.
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The ISO time for a datetime-local value, or null when it is empty.
export function fromLocalInput(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Start and end inputs. The end is optional unless `endRequired` is set.
export function ScheduleFields({ start, end, onStart, onEnd, endRequired = false, endHelp }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField
        label="Starts"
        type="datetime-local"
        value={start}
        onChange={(e) => onStart(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        fullWidth
        required
      />
      <TextField
        label={endRequired ? 'Ends' : 'Ends (optional)'}
        type="datetime-local"
        value={end}
        onChange={(e) => onEnd(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        helperText={endHelp}
        fullWidth
        required={endRequired}
      />
    </Stack>
  );
}
