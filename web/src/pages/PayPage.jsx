import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Container, Paper, Stack, Typography, CircularProgress } from '@mui/material';
import dropin from 'braintree-web-drop-in';
import { api } from '../api/client.js';
import { subscribeLive } from '../api/live.js';

// Public page for paying a charging session. Card details are never typed into
// our own form: Stripe and Square take the card on their hosted pages, and
// Braintree's Drop-in sends card data straight to Braintree.

function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// How long the pay page waits for the payment to be confirmed after Stripe sends the driver back.
const CONFIRM_WAIT_MS = 20_000;

export function PayPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [charge, setCharge] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(params.get('paid') === '1');
  const dropinContainer = useRef(null);
  const dropinInstance = useRef(null);

  async function load() {
    try {
      const { data } = await api.get(`/api/pay/${token}`);
      setCharge(data);
      return data;
    } catch (err) {
      if (err.response?.status === 404) setNotFound(true);
      else setError('Could not load this payment. Try again in a moment.');
      return null;
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  // After Stripe sends the driver back, the webhook may not have arrived yet. Wait for the
  // server to announce the payment, and stop waiting after a while.
  useEffect(() => {
    if (!confirming) return undefined;
    const checkPaid = async () => {
      const latest = await load();
      if (latest && latest.status !== 'PENDING') setConfirming(false);
    };
    const unsubscribe = subscribeLive(`/api/pay/${token}/live`, (notice) => {
      if (!notice || notice.model === 'charge') checkPaid();
    });
    // The payment may have landed before the stream opened.
    checkPaid();
    const giveUp = setTimeout(() => setConfirming(false), CONFIRM_WAIT_MS);
    return () => {
      unsubscribe();
      clearTimeout(giveUp);
    };
  }, [confirming, token]);

  // Braintree: mount the Drop-in card form once we have a client token.
  useEffect(() => {
    if (!charge?.braintreeClientToken || charge.status !== 'PENDING' || !dropinContainer.current) return undefined;
    let cancelled = false;
    dropin
      .create({ authorization: charge.braintreeClientToken, container: dropinContainer.current, card: {} })
      .then((instance) => {
        if (cancelled) return instance.teardown();
        dropinInstance.current = instance;
      })
      .catch(() => setError('The card form could not load. Try again later.'));
    return () => {
      cancelled = true;
      dropinInstance.current?.teardown?.();
      dropinInstance.current = null;
    };
  }, [charge?.braintreeClientToken, charge?.status]);

  // Stripe and Square both send the driver to their own hosted checkout page.
  async function payOnHostedPage(provider) {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(`/api/pay/${token}/${provider}`);
      window.location.assign(data.url);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not start the payment.');
      setBusy(false);
    }
  }

  async function payWithBraintree() {
    setError('');
    setBusy(true);
    try {
      const { nonce } = await dropinInstance.current.requestPaymentMethod();
      await api.post(`/api/pay/${token}/braintree`, { nonce });
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'The payment did not go through.');
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">This payment link doesn't exist or has expired.</Alert>
      </Container>
    );
  }
  if (!charge) {
    return (
      <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
        {error ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
      </Container>
    );
  }

  const paid = charge.status === 'PAID';
  const pending = charge.status === 'PENDING';

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Charging session
        </Typography>
        <Typography color="text.secondary" gutterBottom>
          {charge.stationName}
        </Typography>

        <Stack spacing={1} sx={{ my: 2 }}>
          <Typography>Time connected: {charge.durationMinutes} min</Typography>
          {charge.energyKwh != null && <Typography>Energy: {charge.energyKwh.toFixed(2)} kWh</Typography>}
          {charge.heldCents > 0 && (
            <Typography>Your card hold already covered {money(charge.heldCents, charge.currency)}.</Typography>
          )}
          <Typography variant="h4" fontWeight={600} sx={{ mt: 1 }}>
            {money(charge.amountCents, charge.currency)}
          </Typography>
          {charge.heldCents > 0 && charge.amountCents > 0 && <Typography color="text.secondary">Still to pay</Typography>}
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {paid && <Alert severity="success">Payment received. Thank you!</Alert>}
        {!paid && confirming && (
          <Alert severity="info" icon={<CircularProgress size={18} />}>
            Confirming your payment…
          </Alert>
        )}
        {!paid && charge.status === 'NEEDS_REVIEW' && (
          <Alert severity="warning">
            This session is being checked by the operator. You'll be contacted if anything is owed.
          </Alert>
        )}
        {!paid && charge.status === 'NO_CHARGE' && <Alert severity="info">Nothing is owed for this session.</Alert>}

        {pending && (charge.provider === 'STRIPE' || charge.provider === 'SQUARE') && (
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => payOnHostedPage(charge.provider.toLowerCase())}
            disabled={busy}
          >
            {busy ? 'Opening checkout…' : 'Pay by card'}
          </Button>
        )}

        {pending && charge.provider === 'BRAINTREE' && (
          <Stack spacing={2}>
            <div ref={dropinContainer} />
            <Button variant="contained" size="large" fullWidth onClick={payWithBraintree} disabled={busy || !dropinInstance.current}>
              {busy ? 'Processing…' : `Pay ${money(charge.amountCents, charge.currency)}`}
            </Button>
          </Stack>
        )}

        {pending && !charge.provider && (
          <Alert severity="info">Online payment isn't set up for this station. Please ask the operator how to pay.</Alert>
        )}
      </Paper>
    </Container>
  );
}
