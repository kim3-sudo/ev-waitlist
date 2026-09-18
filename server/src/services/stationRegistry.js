// Tracks live OCPP websocket connections, keyed by station "identity"
// (the id a charge point authenticates with, distinct from its DB row id).
const clientsByIdentity = new Map();

export const registry = {
  add(identity, client) {
    clientsByIdentity.set(identity, client);
  },
  remove(identity) {
    clientsByIdentity.delete(identity);
  },
  getClient(identity) {
    return clientsByIdentity.get(identity);
  },
  isConnected(identity) {
    return clientsByIdentity.has(identity);
  },
};
