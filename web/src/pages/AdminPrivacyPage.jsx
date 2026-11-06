import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Container, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';

// How long this site keeps drivers' personal details, and how to erase them early.
export function AdminPrivacyPage() {
  const [queueDays, setQueueDays] = useState('30');
  const [financialDays, setFinancialDays] = useState('30');
  const [keepFinancial, setKeepFinancial] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [entryId, setEntryId] = useState('');

  useEffect(() => {
    api
      .get('/api/admin/privacy/retention')
      .then(({ data }) => {
        setQueueDays(String(data.queueRetentionDays));
        setKeepFinancial(data.financialRetentionDays === null);
        setFinancialDays(data.financialRetentionDays === null ? '30' : String(data.financialRetentionDays));
      })
      .catch(() => setMessage({ severity: 'error', text: 'Could not load the retention settings.' }));
  }, []);

  async function saveRetention(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.put('/api/admin/privacy/retention', {
        queueRetentionDays: Number(queueDays),
        financialRetentionDays: keepFinancial ? null : Number(financialDays),
      });
      setMessage({ severity: 'success', text: 'Retention periods saved.' });
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not save the retention periods.' });
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await api.post('/api/admin/privacy/erase', { queueEntryId: entryId.trim() });
      setMessage({
        severity: 'success',
        text: `Erased. Complaint notes cleared: ${data.complaintNotesCleared}. Charges cleared: ${data.chargesCleared}.`,
      });
      setEntryId('');
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not erase the details.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {message && (
        <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }} component="form" onSubmit={saveRetention}>
        <Stack spacing={2}>
          <Typography variant="h6">How long to keep drivers&apos; details</Typography>
          <Typography variant="body2" color="text.secondary">
            Names, contact details and plate or permit numbers are cleared this many days after a waitlist entry closes.
            Payer details on charges are cleared after the financial period. Amounts and dates are kept.
            Set these to match your data-protection and accounting obligations. The defaults (30 days) are a starting
            point, not legal advice.
          </Typography>

          <TextField
            label="Waitlist details: days after an entry closes"
            type="number"
            value={queueDays}
            onChange={(e) => setQueueDays(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 3650 } }}
            required
          />

          <TextField
            label="Payer details on charges: days"
            type="number"
            value={financialDays}
            onChange={(e) => setFinancialDays(e.target.value)}
            disabled={keepFinancial}
            slotProps={{ htmlInput: { min: 1, max: 3650 } }}
          />
          <FormControlLabel
            control={<Checkbox checked={keepFinancial} onChange={(e) => setKeepFinancial(e.target.checked)} />}
            label="Keep payer details indefinitely (you must check your own record-keeping duties)"
          />

          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button type="submit" variant="contained" disabled={busy}>
              Save periods
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Erase one driver now</Typography>
          <Typography variant="body2" color="text.secondary">
            Clears a driver&apos;s name, contact, plate and permit on their waitlist entry, the notes on their complaints,
            and the payer details on their charges. Use the entry ID from the waitlist record.
          </Typography>
          <TextField label="Waitlist entry ID" value={entryId} onChange={(e) => setEntryId(e.target.value)} />
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button color="error" variant="outlined" disabled={busy || !entryId.trim()} onClick={erase}>
              Erase now
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
