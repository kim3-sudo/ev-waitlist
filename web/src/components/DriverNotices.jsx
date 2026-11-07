import { Alert, Chip, Stack, Typography } from '@mui/material';
import { formatWhen } from './ScheduleFields.jsx';

// What a price change means to a driver, in words.
export function priceChangeText(change) {
  if (change.kind === 'COMPLIMENTARY') return 'Free charging';
  return change.percent > 0 ? `Prices up ${change.percent}%` : `Prices down ${Math.abs(change.percent)}%`;
}

function until(endsAt) {
  return endsAt ? ` until ${formatWhen(endsAt)}` : '';
}

// Site-wide notices across the top of the driver page: alerts, then price changes.
export function SiteNotices({ alerts = [], pricing = [], paymentOutage = null }) {
  if (alerts.length === 0 && pricing.length === 0 && !paymentOutage) return null;
  return (
    <Stack spacing={1} sx={{ mb: 3 }}>
      {paymentOutage && paymentOutage.mode === 'LOCKOUT' && (
        <Alert severity="warning">
          Payment is unavailable, so joining the waitlist is paused. Please try again soon.
        </Alert>
      )}
      {paymentOutage && paymentOutage.mode === 'COMPLIMENTARY' && (
        <Alert severity="success">Payment is unavailable, so charging is free until it recovers.</Alert>
      )}
      {alerts.map((alert) => (
        <Alert key={alert.id} severity={alert.severity === 'WARNING' ? 'warning' : 'info'}>
          {alert.message}
          {until(alert.endsAt)}
        </Alert>
      ))}
      {pricing.map((change) => (
        <Alert key={change.id} severity={change.kind === 'COMPLIMENTARY' ? 'success' : 'warning'}>
          {priceChangeText(change)} at this site
          {change.label ? ` (${change.label})` : ''}
          {until(change.endsAt)}.
        </Alert>
      ))}
    </Stack>
  );
}

// Notices for one charge point: its alerts and any price change that covers it.
export function StationNotices({ notices }) {
  if (!notices || (notices.alerts.length === 0 && notices.pricing.length === 0)) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {notices.alerts.map((alert) => (
        <Stack key={alert.id} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" color={alert.severity === 'WARNING' ? 'warning' : 'info'} label={alert.message} />
          {alert.endsAt && (
            <Typography variant="caption" color="text.secondary">
              until {formatWhen(alert.endsAt)}
            </Typography>
          )}
        </Stack>
      ))}
      {notices.pricing.map((change) => (
        <Stack key={change.id} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            color={change.kind === 'COMPLIMENTARY' ? 'success' : 'warning'}
            variant="outlined"
            label={change.label ? `${priceChangeText(change)}: ${change.label}` : priceChangeText(change)}
          />
          {change.endsAt && (
            <Typography variant="caption" color="text.secondary">
              until {formatWhen(change.endsAt)}
            </Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
}
