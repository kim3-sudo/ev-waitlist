import './loadRootEnv.js';

// Bootstrap settings only: what the server needs before it can reach the
// database. Everything else (public URLs, reservation window, payment provider
// keys) lives in the ConfigValue table, edited in the admin UI, and is loaded
// into this object by services/runtimeConfig.js.
//
// The defaults below are used until the database is loaded, and by tests.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  // Encrypts secret values stored in the database. Must stay the same across
  // restarts: changing it makes saved secrets unreadable (re-enter them after).
  encryptionKey: process.env.CONFIG_ENCRYPTION_KEY ?? '',

  publicUrl: 'http://localhost:4000',
  corsOrigin: 'http://localhost:5173',
  webUrl: 'http://localhost:5173',
  reservationWindowMinutes: 15,

  stripe: { secretKey: '', webhookSecret: '' },
  braintree: { environment: 'sandbox', merchantId: '', publicKey: '', privateKey: '' },
  square: {
    environment: 'sandbox',
    accessToken: '',
    locationId: '',
    webhookSignatureKey: '',
    webhookUrl: '',
  },
};
