import { state } from "./state.js";
import { writeToSession } from "./session.js";
import { getClientsForSession, broadcastControlChanged } from "./clients.js";
import { readdir } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

const UPLOAD_ROOT = "/tmp/buntty-uploads";

export function handleStatus(sessionId) {
  const session = state.sessions.get(sessionId);
  return Response.json({ active: !!session, sessionId,
    clients: getClientsForSession(sessionId).map(c => ({ id: c.id, name: c.name, isController: c.id === session?.controllerId, readonly: !!c.readonly })),
    controller: session?.controllerId ?? null });
}

export function handleScreen(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return Response.json({ error: "No active session" }, { status: 400 });
  const history = session.history || "";
  const last = history.slice(-4000);
  return Response.json({ sessionId, screen: last });
}

export function handleDownload(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return Response.json({ error: "No active session" }, { status: 400 });
  const clean = (session.history || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  return new Response(clean, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="buntty-${sessionId.replace(/\//g, "")}-${Date.now()}.log"` } });
}

export async function handleInput(req, sessionId) {
  const body = await req.json().catch(() => null);
  return !body?.data ? Response.json({ error: "Missing data" }, { status: 400 })
    : !state.sessions.get(sessionId) || state.sessions.get(sessionId).terminal.closed ? Response.json({ error: "No active session" }, { status: 400 })
    : (writeToSession(sessionId, body.data), Response.json({ ok: true, sessionId }));
}

export function handleTakeControl(sessionId) {
  const session = state.sessions.get(sessionId);
  return !session ? Response.json({ error: "No active session" }, { status: 400 })
    : (session.controllerId = 0, broadcastControlChanged(sessionId, 0, "AI"), Response.json({ ok: true, sessionId, controllerId: 0 }));
}

export async function handleUploads(sessionId) {
  const dir = resolve(UPLOAD_ROOT, sessionId.replace(/^\//, "") || "default");
  try {
    const files = await readdir(dir);
    return Response.json({ sessionId, files: files.map(f => ({ name: f, path: resolve(dir, f), url: `/api/files?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(f)}` })) });
  } catch { return Response.json({ sessionId, files: [] }); }
}

export async function handleFileDownload(sessionId, fileName) {
  if (!fileName) return Response.json({ error: "Missing file parameter" }, { status: 400 });
  const safeName = basename(fileName);
  const dir = resolve(UPLOAD_ROOT, sessionId.replace(/^\//, "") || "default");
  const filePath = resolve(dir, safeName);
  if (!filePath.startsWith(UPLOAD_ROOT)) return Response.json({ error: "Access denied" }, { status: 403 });
  const file = Bun.file(filePath);
  if (!await file.exists()) return Response.json({ error: "File not found" }, { status: 404 });
  const ext = extname(safeName).toLowerCase();
  const types = { ".txt": "text/plain", ".json": "application/json", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".pdf": "application/pdf" };
  return new Response(file, { headers: { "Content-Type": types[ext] || "application/octet-stream", "Content-Disposition": `attachment; filename="${safeName}"` } });
}
