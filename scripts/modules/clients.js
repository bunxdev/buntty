import { state } from "./state.js";

export function addClient(ws, name, sessionId) {
  const id = state.nextId++, c = { id, name, ws, sessionId };
  state.clients.set(id, c);
  return c;
}

export const removeClient = (id) => state.clients.delete(id);
export const getClientByWs = (ws) => [...state.clients.values()].find(c => c.ws === ws) || null;
export const getClientsForSession = (sessionId) => [...state.clients.values()].filter(c => c.sessionId === sessionId);

export function broadcast(sessionId, msg) {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of getClientsForSession(sessionId)) c.ws.readyState === WebSocket.OPEN && c.ws.send(data);
}

export function broadcastState(sessionId) {
  const session = state.sessions.get(sessionId);
  broadcast(sessionId, { type: "state", controllerId: session?.controllerId ?? null,
    clients: getClientsForSession(sessionId).map(c => ({ id: c.id, name: c.name, isController: c.id === session?.controllerId })) });
}

export function broadcastControlChanged(sessionId, id, name) {
  broadcast(sessionId, { type: "control_changed", controllerId: id, controllerName: name });
  broadcastState(sessionId);
}
