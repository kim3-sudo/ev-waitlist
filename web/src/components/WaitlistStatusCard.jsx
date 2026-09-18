import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Chip,
  Stack,
  LinearProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { api } from '../api/client.js';

const POLL_MS = 5000;

const STATUS_COPY = {
  WAITING: { label: 'Waiting', color: 'default' },
  NOTIFIED: { label: "It's your turn", color: 'success' },
  COMPLETED: { label: 'Session started', color: 'success' },
  CANCELLED: { label: 'Cancelled', color: 'default' },
  EXPIRED: { label: 'Expired', color: 'warning' },
};

function useCountdown(expiresAt) {
  const [remainingMs, setRemainingMs] = useState(() => (expiresAt ? new Date(expiresAt) - Date.now() : null));

  useEffect(() => {
    if (!expiresAt) return undefined;
    const id = setInterval(() => setRemainingMs(new Date(expiresAt) - Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remainingMs;
}

export function WaitlistStatusCard({ entryId, onLeave }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [started, setStarted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const { data: entry } = await api.get(`/api/waitlist/${entryId}`);
        if (!cancelled) setData(entry);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [entryId]);

  const remainingMs = useCountdown(data?.reservation?.expiresAt);

  if (error) return null;
  if (!data) return null;

  const statusInfo = STATUS_COPY[data.status] ?? { label: data.status, color: 'default' };
  const isActive = data.status === 'WAITING' || data.status === 'NOTIFIED';

  async function handleStartCharging() {
    setStarting(true);
    setStartError('');
    try {
      await api.post(`/api/waitlist/${entryId}/start-charging`);
      setStarted(true);
    } catch (err) {
      setStartError(err.response?.data?.error ?? 'Could not start charging. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function handleReportSubmit() {
    setReportSubmitting(true);
    try {
      await api.post(`/api/waitlist/${entryId}/report-line-cutter`, { note: reportNote });
      setReportSent(true);
      setReportOpen(false);
      setReportNote('');
    } catch {
      // best-effort -- leave the dialog open so the driver can retry
    } finally {
      setReportSubmitting(false);
    }
  }

  return (
    <Card variant="outlined" sx={{ mb: 2, borderColor: 'primary.main' }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Typography variant="subtitle2" color="text.secondary">
              {data.stationName}
              {data.licensePlate && ` · ${data.licensePlate}`}
              {data.parkingPermit && ` · Permit ${data.parkingPermit}`}
            </Typography>
            <Typography variant="h6" sx={{ mt: 0.5 }}>
              {data.status === 'WAITING' && `Position ${data.position} in line`}
              {data.status === 'NOTIFIED' && 'A charger is ready for you!'}
              {data.status === 'COMPLETED' && 'Charging session started'}
              {data.status === 'EXPIRED' && 'Your reserved slot expired'}
              {data.status === 'CANCELLED' && 'You left the waitlist'}
            </Typography>
          </div>
          <Chip size="small" label={statusInfo.label} color={statusInfo.color} />
        </Stack>

        {data.status === 'NOTIFIED' && remainingMs != null && (
          <Stack sx={{ mt: 2 }} spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {remainingMs > 0
                ? `Plug in within ${Math.max(0, Math.ceil(remainingMs / 60000))} min (connector ${data.reservation.connectorId})`
                : 'Time is up — your spot may be released any moment.'}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, Math.max(0, 100 - (remainingMs / (15 * 60000)) * 100))}
            />
          </Stack>
        )}

        {startError && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setStartError('')}>
            {startError}
          </Alert>
        )}
        {started && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Charger unlocked — plug in to begin.
          </Alert>
        )}
        {reportSent && (
          <Alert severity="info" sx={{ mt: 2 }} onClose={() => setReportSent(false)}>
            Thanks — we've flagged this for an admin to look into.
          </Alert>
        )}
      </CardContent>
      {isActive && (
        <CardActions sx={{ flexWrap: 'wrap' }}>
          {data.status === 'NOTIFIED' && !started && (
            <Button size="small" variant="contained" onClick={handleStartCharging} disabled={starting}>
              {starting ? 'Unlocking…' : 'Start charging'}
            </Button>
          )}
          <Button size="small" color="error" onClick={async () => {
            await api.delete(`/api/waitlist/${entryId}`);
            onLeave(entryId);
          }}>
            Leave waitlist
          </Button>
          <Button size="small" color="inherit" onClick={() => setReportOpen(true)}>
            Report a line-cutter
          </Button>
        </CardActions>
      )}

      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Report a line-cutter</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Let an admin know someone appears to have taken your spot at {data.stationName}.
          </Typography>
          <TextField
            label="What happened? (optional)"
            value={reportNote}
            onChange={(e) => setReportNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReportOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleReportSubmit} disabled={reportSubmitting}>
            {reportSubmitting ? 'Sending…' : 'Send report'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
