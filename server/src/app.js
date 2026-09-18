import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './auth/auth.routes.js';
import { samlRouter } from './auth/saml.routes.js';
import { requireAdmin } from './auth/auth.middleware.js';
import { stationsRouter } from './routes/stations.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { waitlistRouter } from './routes/waitlist.routes.js';
import { adminStationsRouter } from './routes/admin.stations.routes.js';
import { adminZonesRouter } from './routes/admin.zones.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { adminSettingsRouter } from './routes/admin.settings.routes.js';
import { adminReportsRouter } from './routes/admin.reports.routes.js';
import { adminUsersRouter } from './routes/admin.users.routes.js';
import { adminSamlRouter } from './routes/admin.saml.routes.js';

// Builds the REST API's Express app. Deliberately has no side effects
// (no listen(), no OCPP central system, no background timers) so it can be
// mounted standalone -- e.g. under supertest in the test suite.
export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/auth/saml', samlRouter);
  app.use('/api/stations', stationsRouter);
  app.use('/api/zones', zonesRouter);
  app.use('/api/waitlist', waitlistRouter);
  app.use('/api/admin/stations', requireAdmin, adminStationsRouter);
  app.use('/api/admin/zones', requireAdmin, adminZonesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/admin/settings', requireAdmin, adminSettingsRouter);
  app.use('/api/admin/reports', requireAdmin, adminReportsRouter);
  app.use('/api/admin/users', requireAdmin, adminUsersRouter);
  app.use('/api/admin/saml', requireAdmin, adminSamlRouter);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
