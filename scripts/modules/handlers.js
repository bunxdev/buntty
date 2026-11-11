import { state, normalizeSessionId } from "./state.js";
import { createSession, writeToSession } from "./session.js";
import { addClient, removeClient, getClientByWs, getClientsForSession, broadcastState, broadcastControlChanged } from "./clients.js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export function onOpen(ws) {
  const url = new URL(ws.data?.url || "http://x"), sessionId = normalizeSessionId(url.searchParams.get("session")),
    name = url.searchParams.get("name") || `User${state.nextId}`, readonly = url.searchParams.get("readonly") === "1",
    client = addClient(ws, name, sessionId, readonly), session = createSession(sessionId, client.id);
  if (session.controllerId == null && !readonly) session.controllerId = client.id;
  const clients = getClientsForSession(sessionId);
  ws.send(JSON.stringify({ type: "welcome", clientId: client.id, name, sessionId, controllerId: session.controllerId, readonly,
    clients: clients.map(c => ({ id: c.id, name: c.name, isController: c.id === session.controllerId, readonly: !!c.readonly })) }));
  session.history && ws.send(JSON.stringify({ type: "history", data: session.history }));
  broadcastState(sessionId); console.log(`[BunTTY] ${name} connected to ${sessionId} (ID: ${client.id}${readonly ? ", readonly" : ""}, total: ${clients.length})`);
}

export function onMessage(ws, message) {
  const client = getClientByWs(ws); if (!client) return; const session = state.sessions.get(client.sessionId);
  try { const msg = JSON.parse(String(message));
    msg.type === "input" && session && !client.readonly && client.id === session.controllerId && !session.terminal.closed && session.terminal.write(msg.data);
    msg.type === "resize" && session && !session.terminal.closed && (session.terminal.resize(Math.max(1, Math.min(500, msg.cols || 80)), Math.max(1, Math.min(200, msg.rows || 24))));
    if (msg.type === "take_control" && session && !client.readonly) { session.controllerId = client.id; broadcastControlChanged(client.sessionId, client.id, client.name); console.log(`[BunTTY] ${client.name} took control of ${client.sessionId}`); }
    if (msg.type === "release_control" && session && session.controllerId === client.id) {
      const others = getClientsForSession(client.sessionId).filter(c => c.id !== client.id);
      others.length > 0 ? (session.controllerId = others[0].id, broadcastControlChanged(client.sessionId, others[0].id, others[0].name)) : (session.controllerId = null, broadcastState(client.sessionId));
    }
    if (msg.type === "upload" && session && !client.readonly && msg.name && msg.data) {
      handleUpload(ws, client, msg).catch((err) => ws.send(JSON.stringify({ type: "upload_error", name: msg.name, error: err.message })));
    }
  } catch { session && client.id === session.controllerId && !session.terminal.closed && session.terminal.write(String(message)); }
}

export function onClose(ws) {
  const client = getClientByWs(ws); if (!client) return; removeClient(client.id);
  const session = state.sessions.get(client.sessionId), remaining = getClientsForSession(client.sessionId);
  if (session?.controllerId === client.id) {
    remaining.length > 0 ? (session.controllerId = remaining[0].id, broadcastControlChanged(client.sessionId, remaining[0].id, remaining[0].name)) : (session.controllerId = null, broadcastState(client.sessionId));
  } else broadcastState(client.sessionId);
  console.log(`[BunTTY] ${client.name} disconnected from ${client.sessionId}. Session kept alive.`);
}

const UPLOAD_ROOT = "/tmp/buntty-uploads";

async function handleUpload(ws, client, msg) {
  const safeName = msg.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const dir = resolve(UPLOAD_ROOT, client.sessionId.replace(/^\//, "") || "default");
  await mkdir(dir, { recursive: true });
  const dest = resolve(dir, safeName);
  if (!dest.startsWith(dir)) throw new Error("Invalid filename");
  const buf = Buffer.from(msg.data, "base64");
  if (buf.length > 10 * 1024 * 1024) throw new Error("File exceeds 10MB limit");
  await Bun.write(dest, buf);
  ws.send(JSON.stringify({ type: "upload_complete", name: safeName, path: dest, size: buf.length }));
  const session = state.sessions.get(client.sessionId);
  if (session && !session.terminal.closed) session.terminal.write(`\r\n\x1b[33m[BunTTY]\x1b[0m File uploaded: ${dest} (${buf.length} bytes)\r\n`);
  console.log(`[BunTTY] ${client.name} uploaded ${safeName} (${buf.length} bytes) to ${dest}`);
}
