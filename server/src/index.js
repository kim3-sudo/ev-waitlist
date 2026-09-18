import { config } from './config.js';
import { createApp } from './app.js';
import { createCentralSystem } from './ocpp/centralSystem.js';
import { startReservationSweeper } from './services/reservationSweeper.js';

const app = createApp();

const httpServer = app.listen(config.port, () => {
  console.log(`REST API listening on http://localhost:${config.port}`);
});

// OCPP 1.6J charge points connect to ws://host:port/ocpp/<identity>, sharing
// the same HTTP server/port as the REST API.
const centralSystem = createCentralSystem();
httpServer.on('upgrade', centralSystem.handleUpgrade);

startReservationSweeper();
