import { state, normalizeSessionId, sanitizeName } from "./state.js";
import { createSession, recordEvent, MAX_SESSIONS } from "./session.js";
import { addClient, removeClient, getClientByWs, getClientsForSession, broadcast, broadcastState, broadcastControlChanged } from "./clients.js";
import { saveUpload, MAX_UPLOAD_BYTES } from "./uploads.js";

const ipOf = (ws) => String(ws.data?.ip || "?").replace(/[^0-9a-fA-F.:]/g, "?");

export function onOpen(ws) {
  const url = new URL(ws.data?.url || "http://x"), sessionId = normalizeSessionId(url.searchParams.get("session"));
  if (!sessionId) return void ws.close(1008, "Invalid session");
  const readonly = ws.data?.role !== "full" || url.searchParams.get("readonly") === "1";
  // Only full-access clients may spawn a new shell; view-only clients can just watch existing ones.
  if (!state.sessions.has(sessionId) && ws.data?.role !== "full") return void ws.close(1008, "No such session");
  if (!state.sessions.has(sessionId) && state.sessions.size >= MAX_SESSIONS) return void ws.close(1013, "Too many sessions");
  const name = sanitizeName(url.searchParams.get("name")) || `User${state.nextId}`,
    client = addClient(ws, name, sessionId, readonly), session = createSession(sessionId, readonly ? null : client.id);
  if (session.controllerId == null && !readonly) session.controllerId = client.id;
  const clients = getClientsForSession(sessionId);
  ws.send(JSON.stringify({ type: "welcome", clientId: client.id, name, sessionId, controllerId: session.controllerId, readonly,
    clients: clients.map(c => ({ id: c.id, name: c.name, isController: c.id === session.controllerId, readonly: !!c.readonly })) }));
  session.history && ws.send(JSON.stringify({ type: "history", data: session.history }));
  broadcastState(sessionId); console.log(`[BunTTY] ${name} connected to ${sessionId} (ID: ${client.id}${readonly ? ", readonly" : ""}, ip: ${ipOf(ws)}, total: ${clients.length})`);
}

export function onMessage(ws, message) {
  const client = getClientByWs(ws); if (!client) return; const session = state.sessions.get(client.sessionId);
  try { const msg = JSON.parse(String(message));
    if (msg.type === "input" && typeof msg.data === "string" && session && !client.readonly && client.id === session.controllerId && !session.terminal.closed) {
      session.terminal.write(msg.data);
      recordEvent(session, "i", msg.data);
    }
    if (msg.type === "resize" && session && !client.readonly) {
      // Every writer reports its viewport, but only the controller's size drives the PTY;
      // otherwise viewers with different window sizes keep resizing the shell under the controller.
      const clamp = (v, max, def) => Number.isFinite(v) ? Math.max(1, Math.min(max, Math.trunc(v))) : def;
      client.size = { cols: clamp(msg.cols, 500, 80), rows: clamp(msg.rows, 200, 24) };
      if (client.id === session.controllerId) applySize(session, client.size);
    }
    if (msg.type === "take_control" && session && !client.readonly) {
      session.controllerId = client.id; applySize(session, client.size);
      broadcastControlChanged(client.sessionId, client.id, client.name); console.log(`[BunTTY] ${client.name} took control of ${client.sessionId}`);
    }
    if (msg.type === "release_control" && session && session.controllerId === client.id) {
      handOffControl(session, client.sessionId, getClientsForSession(client.sessionId).filter(c => c.id !== client.id));
    }
    if (msg.type === "upload" && session && !client.readonly && typeof msg.name === "string" && msg.name && typeof msg.data === "string") {
      handleUpload(ws, client, msg).catch((err) => {
        const known = /^(Invalid filename|File exceeds 10MB limit)$/.test(err.message);
        if (!known) console.error(`[BunTTY] upload failed for ${client.name}: ${String(err.message).replace(/[\x00-\x1f]/g, "?")}`);
        ws.send(JSON.stringify({ type: "upload_error", name: String(msg.name).slice(0, 200), error: known ? err.message : "Upload failed" }));
      });
    }
  } catch { /* drop malformed messages silently */ }
}

export function onClose(ws) {
  const client = getClientByWs(ws); if (!client) return; removeClient(client.id);
  const session = state.sessions.get(client.sessionId), remaining = getClientsForSession(client.sessionId);
  if (session?.controllerId === client.id) {
    handOffControl(session, client.sessionId, remaining);
  } else broadcastState(client.sessionId);
  console.log(`[BunTTY] ${client.name} disconnected from ${client.sessionId}. Session kept alive.`);
}

export function handOffControl(session, sessionId, candidates) {
  const next = candidates.find(c => !c.readonly);
  next ? (session.controllerId = next.id, applySize(session, next.size), broadcastControlChanged(sessionId, next.id, next.name)) : (session.controllerId = null, broadcastState(sessionId));
}

// Resize the PTY to a client's last reported viewport, recording only real changes.
export function applySize(session, size) {
  if (!size || session.terminal.closed) return;
  const cur = session.size || { cols: session.recordingHeader.width, rows: session.recordingHeader.height };
  if (cur.cols === size.cols && cur.rows === size.rows) return;
  session.terminal.resize(size.cols, size.rows);
  session.size = size;
  recordEvent(session, "r", `${size.cols}x${size.rows}`);
}

async function handleUpload(ws, client, msg) {
  if (typeof msg.data !== "string" || msg.data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) throw new Error("File exceeds 10MB limit");
  const { name: safeName, path: dest, size } = await saveUpload(client.sessionId, msg.name, Buffer.from(msg.data, "base64"));
  ws.send(JSON.stringify({ type: "upload_complete", name: safeName, path: dest, size }));
  announceUpload(client.sessionId, dest, size);
  console.log(`[BunTTY] ${client.name} uploaded ${safeName} (${size} bytes) to ${dest} (ip: ${ipOf(ws)})`);
}

// Tell everyone watching the session that a file landed (both upload paths use this).
export const announceUpload = (sessionId, dest, size) =>
  broadcast(sessionId, { type: "output", data: `\r\n\x1b[33m[BunTTY]\x1b[0m File uploaded: ${dest} (${size} bytes)\r\n` });
