import http from 'node:http';
import { createApp } from '../../src/app.js';

// One HTTP server for the whole test file, listening on a free local port. Each
// request in the tests goes to this server, instead of starting and stopping a
// new one per request, which made the tests fail intermittently. The server is
// unreferenced so it never keeps the test process alive after the tests finish.
const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
server.unref();

export const app = server;
