import { Accordion, AccordionDetails, AccordionSummary, Alert, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { priceChangeText } from '../DriverNotices.jsx';

const DAY_SHORT = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
const pad = (hour) => `${String(hour).padStart(2, '0')}:00`;

// "USD 0.40 per minute", or "USD 0.30 per kWh".
export function formatPrice(pricing, cents) {
  const amount = `${pricing.currency} ${(cents / 100).toFixed(2)}`;
  if (pricing.unit === 'KWH') return `${amount} per kWh`;
  return `${amount} per ${pricing.unit === 'HOUR' ? 'hour' : 'minute'}`;
}

function daysText(days) {
  if (days.length === 7) return 'Every day';
  return days.map((d) => DAY_SHORT[d] ?? d).join(', ');
}

function windowText(window) {
  return `${daysText(window.days)}, ${pad(window.startHour)}–${pad(window.endHour)}`;
}

// What a driver pays: the rate now, and -- collapsed by default -- the other times.
// Price changes (surge, complimentary) come with the charge point and are shown at the top.
export function PricingPanel({ pricing, priceNotices = [] }) {
  if (!pricing) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading prices…
      </Typography>
    );
  }

  const activeWindow = pricing.windows?.find((w) => w.active) ?? null;
  const currentRate = pricing.currentRateCents;
  const others = pricing.windows?.filter((w) => !w.active) ?? [];
  // The standard rate is an "other time" whenever a time window is in effect now.
  const showStandard = Boolean(activeWindow);

  return (
    <Stack spacing={2}>
      {priceNotices.length > 0 && (
        <Stack spacing={1}>
          {priceNotices.map((change) => (
            <Alert key={change.id} severity={change.kind === 'COMPLIMENTARY' ? 'success' : 'warning'}>
              {priceChangeText(change)}
              {change.label ? ` (${change.label})` : ''}
            </Alert>
          ))}
        </Stack>
      )}

      <div>
        <Typography variant="overline" color="text.secondary">
          Right now
        </Typography>
        <Typography variant="h5" fontWeight={600}>
          {formatPrice(pricing, currentRate)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {activeWindow ? `Time-of-day rate, ${windowText(activeWindow)}` : 'Standard rate'}
        </Typography>
      </div>

      {(others.length > 0 || showStandard) && (
        <Accordion disableGutters elevation={0} variant="outlined" sx={{ '&::before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Other times</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Table size="small">
              <TableBody>
                {showStandard && (
                  <TableRow>
                    <TableCell sx={{ pl: 0 }}>Standard rate</TableCell>
                    <TableCell>{formatPrice(pricing, pricing.baseRateCents)}</TableCell>
                  </TableRow>
                )}
                {others.map((w) => (
                  <TableRow key={`${w.days.join()}-${w.startHour}-${w.endHour}`}>
                    <TableCell sx={{ pl: 0 }}>{windowText(w)}</TableCell>
                    <TableCell>{formatPrice(pricing, w.rateCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
