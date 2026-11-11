// Tracks live OCPP websocket connections, keyed by station "identity"
// (the id a charge point authenticates with, distinct from its DB row id).
const clientsByIdentity = new Map();

export const registry = {
  add(identity, client) {
    clientsByIdentity.set(identity, client);
  },
  // With `client`, removes only if that connection is still the registered one.
  remove(identity, client) {
    if (client && clientsByIdentity.get(identity) !== client) return;
    clientsByIdentity.delete(identity);
  },
  getClient(identity) {
    return clientsByIdentity.get(identity);
  },
  isConnected(identity) {
    return clientsByIdentity.has(identity);
  },
};
