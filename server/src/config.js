import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Externally-reachable base URL of this server, used to build the SAML
  // SP's entity ID and ACS URL.
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:4000',
  reservationWindowMinutes: Number(process.env.RESERVATION_WINDOW_MINUTES ?? 15),
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
};
