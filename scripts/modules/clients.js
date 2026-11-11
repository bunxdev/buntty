import { state } from "./state.js";

// Indexes so per-message lookups don't scan every client:
// ws -> client (O(1) in onMessage/onClose) and sessionId -> Set<client> (O(1) per broadcast).
const byWs = new WeakMap();
const bySession = new Map();

export function addClient(ws, name, sessionId, readonly = false) {
  const id = state.nextId++, c = { id, name, ws, sessionId, readonly };
  state.clients.set(id, c);
  byWs.set(ws, c);
  let set = bySession.get(sessionId);
  if (!set) bySession.set(sessionId, set = new Set());
  set.add(c);
  return c;
}

export function removeClient(id) {
  const c = state.clients.get(id); if (!c) return false;
  state.clients.delete(id);
  byWs.delete(c.ws);
  const set = bySession.get(c.sessionId);
  if (set) { set.delete(c); if (!set.size) bySession.delete(c.sessionId); }
  return true;
}

export const getClientByWs = (ws) => byWs.get(ws) || null;
export const getClientsForSession = (sessionId) => [...(bySession.get(sessionId) || [])];

export function broadcast(sessionId, msg) {
  const set = bySession.get(sessionId); if (!set) return;
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of set) c.ws.readyState === WebSocket.OPEN && c.ws.send(data);
}

export function broadcastState(sessionId) {
  const session = state.sessions.get(sessionId);
  broadcast(sessionId, { type: "state", controllerId: session?.controllerId ?? null,
    clients: getClientsForSession(sessionId).map(c => ({ id: c.id, name: c.name, isController: c.id === session?.controllerId, readonly: !!c.readonly })) });
}

export function broadcastControlChanged(sessionId, id, name) {
  broadcast(sessionId, { type: "control_changed", controllerId: id, controllerName: name });
  broadcastState(sessionId);
}
