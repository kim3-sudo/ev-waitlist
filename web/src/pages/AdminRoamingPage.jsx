import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Container,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';

// Roaming lets drivers from other networks join this site's waitlist. It stays
// off until an administrator has the terms reviewed and acknowledges them.
export function AdminRoamingPage() {
  const [state, setState] = useState(null);
  const [extra, setExtra] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [partners, setPartners] = useState([]);
  const [partnerName, setPartnerName] = useState('');
  const [invitation, setInvitation] = useState(null);

  async function loadPartners() {
    const { data } = await api.get('/api/admin/ocpi/partners');
    setPartners(data);
  }

  function applyState(data) {
    setState(data);
    setExtra(data.warningExtra ?? '');
  }

  useEffect(() => {
    api
      .get('/api/admin/roaming')
      .then(({ data }) => applyState(data))
      .catch(() => setMessage({ severity: 'error', text: 'Could not load the roaming settings.' }));
    loadPartners().catch(() => {});
  }, []);

  // Runs a partner action, then shows its outcome and reloads the partner list.
  async function runPartnerAction(action, okText) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (okText) setMessage({ severity: 'success', text: okText });
      await loadPartners();
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not complete that.' });
    } finally {
      setBusy(false);
    }
  }

  const invite = () =>
    runPartnerAction(async () => {
      const { data } = await api.post('/api/admin/ocpi/partners', { name: partnerName.trim() });
      setInvitation({ name: data.name, registrationToken: data.registrationToken, versionsUrl: data.versionsUrl });
      setPartnerName('');
    }, 'Partner invited. Give them the registration token now; it is shown only once.');

  const sendNow = () =>
    runPartnerAction(async () => {
      const { data } = await api.post('/api/admin/ocpi/dispatch');
      setMessage({ severity: 'success', text: `Sent ${data.sent} queued message(s).` });
    });

  async function save(body, okText) {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await api.put('/api/admin/roaming', body);
      applyState(data);
      setMessage({ severity: 'success', text: okText });
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not save the roaming settings.' });
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        {message && <Alert severity={message.severity}>{message.text}</Alert>}
      </Container>
    );
  }

  const awaitingAcknowledgement = state.needsAcknowledgement;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Alert severity="warning" sx={{ mb: 3 }}>
        Before you turn roaming on, have your own legal counsel review the roaming terms and the warning drivers see.
        Plugyard does not provide legal advice, and the text below is a draft.
      </Alert>

      {message && (
        <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Roaming</Typography>

          <FormControlLabel
            control={
              <Switch
                checked={state.switchedOn && !awaitingAcknowledgement}
                disabled={busy || (awaitingAcknowledgement && !state.switchedOn)}
                onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Roaming is on.' : 'Roaming is off.')}
              />
            }
            label="Allow roaming drivers to join this site's waitlist"
          />
          {awaitingAcknowledgement && (
            <Typography variant="body2" color="text.secondary">
              Tick the acknowledgement below before turning roaming on.
            </Typography>
          )}

          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            Warning text
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Drivers see the required text below, followed by any text you add. The required text cannot be removed.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" color="warning" label="Draft: counsel review required" />
          </Stack>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', whiteSpace: 'pre-line' }}>
            <Typography variant="body2">{state.warningCore}</Typography>
          </Paper>
          <TextField
            label="Additional text for this site (optional)"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            multiline
            minRows={3}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            helperText={`${extra.length}/1000. Changing this text needs a new acknowledgement and turns roaming off.`}
            fullWidth
          />
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              disabled={busy || extra === (state.warningExtra ?? '')}
              onClick={() => save({ warningExtra: extra }, 'Warning text saved. Acknowledge it again to turn roaming on.')}
            >
              Save text
            </Button>
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={!awaitingAcknowledgement}
                disabled={busy || !awaitingAcknowledgement}
                onChange={(e) => {
                  if (e.target.checked) save({ acknowledge: true }, 'Acknowledged.');
                }}
              />
            }
            label="I have had my legal counsel review the roaming terms and this warning text"
          />
          {!awaitingAcknowledgement && state.acknowledgedAt && (
            <Typography variant="caption" color="text.secondary">
              Acknowledged on {new Date(state.acknowledgedAt).toLocaleString()}.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Roaming partners</Typography>
          <Typography variant="body2" color="text.secondary">
            Invite an e-mobility provider. It registers with the invitation&apos;s token and the address shown after
            you invite it. Partners see this site&apos;s stations and tariffs, and receive drivers&apos; sessions and CDRs.
          </Typography>
          {invitation && (
            <Alert severity="info" onClose={() => setInvitation(null)}>
              <Typography variant="body2">Partner: {invitation.name}</Typography>
              <Typography variant="body2">Address: {invitation.versionsUrl}</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Registration token (shown once): {invitation.registrationToken}
              </Typography>
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Partner name" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} fullWidth />
            <Button variant="outlined" disabled={busy || !partnerName.trim() || !state.enabled} onClick={invite}>
              Invite partner
            </Button>
          </Stack>
          {!state.enabled && (
            <Typography variant="caption" color="text.secondary">
              Turn roaming on to invite partners.
            </Typography>
          )}
          {partners.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Stack>
                  <Typography variant="subtitle2">{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.status}
                    {p.partyId ? ` · ${p.partyId}` : ''}
                  </Typography>
                  {p.lastError && (
                    <Typography variant="caption" color="error">
                      {p.lastError}
                    </Typography>
                  )}
                </Stack>
                <Stack direction="row" spacing={1}>
                  {p.status !== 'REVOKED' && (
                    <Button
                      size="small"
                      color="warning"
                      disabled={busy}
                      onClick={() => runPartnerAction(() => api.post(`/api/admin/ocpi/partners/${p.id}/revoke`), 'Partner access revoked.')}
                    >
                      Revoke
                    </Button>
                  )}
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    onClick={() => runPartnerAction(() => api.delete(`/api/admin/ocpi/partners/${p.id}`), 'Partner removed.')}
                  >
                    Remove
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="text" disabled={busy} onClick={sendNow}>
              Send queued messages now
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
