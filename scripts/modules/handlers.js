import { state, normalizeSessionId } from "./state.js";
import { createSession } from "./session.js";
import { validInput, validSize } from "./validation.js";
import { addClient, removeClient, getClientByWs, getClientsForSession, broadcastState, broadcastControlChanged } from "./clients.js";

export function onOpen(ws) {
  const url = new URL(ws.data?.url || "http://x"), sessionId = normalizeSessionId(url.searchParams.get("session")),
    name = (url.searchParams.get("name") || `User${state.nextId}`).slice(0, 80), client = addClient(ws, name, sessionId), session = createSession(sessionId, client.id);
  if (session.controllerId == null) session.controllerId = client.id;
  const clients = getClientsForSession(sessionId);
  ws.send(JSON.stringify({ type: "welcome", clientId: client.id, name, sessionId, controllerId: session.controllerId,
    clients: clients.map(c => ({ id: c.id, name: c.name, isController: c.id === session.controllerId })) }));
  session.history && ws.send(JSON.stringify({ type: "history", data: session.history }));
  broadcastState(sessionId); console.log(`[BunTTY] ${name} connected to ${sessionId} (ID: ${client.id}, total: ${clients.length})`);
}

export function onMessage(ws, message) {
  const client = getClientByWs(ws); if (!client) return; const session = state.sessions.get(client.sessionId);
  let msg;
  try { msg = JSON.parse(String(message)); }
  catch { return; }
  if (!msg || typeof msg !== "object" || !session || session.terminal.closed) return;
  if (msg.type === "input" && client.id === session.controllerId && validInput(msg.data)) session.terminal.write(msg.data);
  if (msg.type === "resize" && client.id === session.controllerId && validSize(msg.cols, msg.rows)) session.terminal.resize(msg.cols, msg.rows);
  if (msg.type === "take_control") {
    session.controllerId = client.id;
    broadcastControlChanged(client.sessionId, client.id, client.name);
  }
  if (msg.type === "release_control" && session.controllerId === client.id) {
    const next = getClientsForSession(client.sessionId).find(c => c.id !== client.id);
    session.controllerId = next?.id ?? null;
    next ? broadcastControlChanged(client.sessionId, next.id, next.name) : broadcastState(client.sessionId);
  }
}

export function onClose(ws) {
  const client = getClientByWs(ws); if (!client) return; removeClient(client.id);
  const session = state.sessions.get(client.sessionId), remaining = getClientsForSession(client.sessionId);
  if (session?.controllerId === client.id) {
    remaining.length > 0 ? (session.controllerId = remaining[0].id, broadcastControlChanged(client.sessionId, remaining[0].id, remaining[0].name)) : (session.controllerId = null, broadcastState(client.sessionId));
  } else broadcastState(client.sessionId);
  console.log(`[BunTTY] ${client.name} disconnected from ${client.sessionId}. Session kept alive.`);
}
