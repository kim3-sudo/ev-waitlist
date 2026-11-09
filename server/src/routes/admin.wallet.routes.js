import { Router } from 'express';
import { runtimeSettingsView, saveRuntimeSettings, siteConfig } from '../services/runtimeConfig.js';
import {
  appleCheck,
  candidateWallet,
  googleCheck,
  googleCredentials,
  walletStatus,
} from '../services/wallet/walletSettings.js';
import { buildPkpass } from '../services/wallet/applePass.js';
import { googleSaveUrl } from '../services/wallet/googlePass.js';
import { designCheck } from '../services/wallet/design.js';

// Wallet pass set-up. Mounted behind wallet.manage. Secrets are never returned, only whether
// they are saved.
export const adminWalletRouter = Router();

function view() {
  return { ...runtimeSettingsView(['wallet']), status: walletStatus(siteConfig().wallet) };
}

adminWalletRouter.get('/', (req, res) => {
  res.json(view());
});

adminWalletRouter.put('/', async (req, res) => {
  const updates = req.body ?? {};
  // Refuse a wrong value before anything is saved. Missing values are allowed, so an operator
  // can save the parts they have and finish the rest later.
  const candidate = candidateWallet(siteConfig().wallet, updates);
  const invalid = [
    ...appleCheck(candidate.apple).invalid,
    ...googleCheck(candidate.google).invalid,
    ...designCheck(candidate.design).invalid,
  ];
  if (invalid.length) return res.status(400).json({ error: invalid.join(' ') });

  const result = await saveRuntimeSettings(updates, ['wallet']);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(view());
});

// Builds one test pass for each platform that has its settings filled in, so an operator can
// see whether signing works before a driver asks for a pass.
adminWalletRouter.post('/test', (req, res) => {
  const wallet = siteConfig().wallet;
  const results = [];

  const apple = appleCheck(wallet.apple);
  if (apple.configured) {
    if (!apple.ready) {
      results.push({ platform: 'apple', ok: false, message: [...apple.missing.map((m) => `${m} is missing.`), ...apple.invalid].join(' ') });
    } else {
      try {
        const pass = buildPkpass(wallet.apple, { serial: '0000000000AA', design: wallet.design });
        results.push({ platform: 'apple', ok: true, message: `Signed a test pass (${pass.length} bytes).` });
      } catch (err) {
        results.push({ platform: 'apple', ok: false, message: `The pass could not be signed: ${err.message}` });
      }
    }
  }

  const google = googleCheck(wallet.google);
  if (google.configured) {
    const credentials = googleCredentials(wallet.google);
    if (!google.ready || !credentials) {
      results.push({ platform: 'google', ok: false, message: [...google.missing.map((m) => `${m} is missing.`), ...google.invalid].join(' ') });
    } else {
      try {
        googleSaveUrl(credentials, '0000000000AA', { origin: 'https://example.com', design: wallet.design });
        results.push({ platform: 'google', ok: true, message: 'Signed a test Google Wallet link. Google checks the class when a driver saves a pass.' });
      } catch (err) {
        results.push({ platform: 'google', ok: false, message: `The link could not be signed: ${err.message}` });
      }
    }
  }

  if (!results.length) {
    return res.status(400).json({ error: 'Fill in the Apple or Google settings first.' });
  }
  res.json({ results });
});
