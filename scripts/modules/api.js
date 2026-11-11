import { state, inside } from "./state.js";
import { writeToSession, recordEvent, recordingFull, MAX_RECORDING_EVENTS, MAX_RECORDING_BYTES } from "./session.js";
import { getClientsForSession, broadcastControlChanged } from "./clients.js";
import { uploadDir, uploadPath } from "./uploads.js";
import { readdir, realpath, stat } from "node:fs/promises";

const noSession = () => Response.json({ error: "No active session" }, { status: 404 });
const liveSession = (id) => { const s = state.sessions.get(id); return s && !s.terminal.closed ? s : null; };
const fileStem = (sessionId) => `buntty-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "") || "root"}-${Date.now()}`;
const attachment = (name) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function handleStatus(sessionId) {
  const session = state.sessions.get(sessionId);
  return Response.json({ active: !!session, sessionId,
    clients: getClientsForSession(sessionId).map(c => ({ id: c.id, name: c.name, isController: c.id === session?.controllerId, readonly: !!c.readonly })),
    controller: session?.controllerId ?? null });
}

export function handleScreen(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  return Response.json({ sessionId, screen: (session.history || "").slice(-4000) });
}

export function handleDownload(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  return new Response(Bun.stripANSI(session.history || ""), { headers: {
    "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": attachment(`${fileStem(sessionId)}.log`) } });
}

export async function handleInput(req, sessionId) {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const body = await req.json().catch(() => null);
  if (typeof body?.data !== "string" || !body.data) return Response.json({ error: "Missing data (non-empty string)" }, { status: 400 });
  const session = liveSession(sessionId);
  if (!session) return noSession();
  writeToSession(sessionId, body.data);
  recordEvent(session, "i", body.data);
  return Response.json({ ok: true, sessionId });
}

export function handleTakeControl(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  session.controllerId = 0;
  broadcastControlChanged(sessionId, 0, "AI");
  console.log(`[BunTTY] API took control of ${sessionId}`);
  return Response.json({ ok: true, sessionId, controllerId: 0 });
}

export async function handleUploads(sessionId) {
  const dir = uploadDir(sessionId);
  try {
    // Only list regular files whose names survive uploadPath() unchanged, so every listed url downloads.
    const entries = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && uploadPath(sessionId, e.name)?.name === e.name);
    const files = await Promise.all(entries.map(async (e) => {
      const f = Bun.file(`${dir}/${e.name}`), st = await f.stat();
      return { name: e.name, size: st.size, modified: st.mtime.toISOString(), type: f.type,
        url: `/api/files?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(e.name)}` };
    }));
    return Response.json({ sessionId, files });
  } catch { return Response.json({ sessionId, files: [] }); }
}

export function handleRecording(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  let cast = JSON.stringify(session.recordingHeader) + "\n";
  for (const ev of session.recording) cast += JSON.stringify(ev) + "\n";
  return new Response(cast, { headers: {
    "Content-Type": "application/x-asciicast", "Content-Disposition": attachment(`${fileStem(sessionId)}.cast`) } });
}

export function handleRecordingStatus(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  const full = recordingFull(session);
  return Response.json({ sessionId, recording: !full, truncated: full, events: session.recording.length, bytes: session.recordingBytes,
    elapsed: Math.round((Date.now() - session.createdAt) / 1000), maxEvents: MAX_RECORDING_EVENTS, maxBytes: MAX_RECORDING_BYTES });
}

export async function handleFileDownload(sessionId, fileName) {
  if (!fileName) return Response.json({ error: "Missing file parameter" }, { status: 400 });
  const target = uploadPath(sessionId, fileName);
  if (!target) return Response.json({ error: "Invalid file name" }, { status: 400 });
  // Resolve symlinks: a link created from the shell must not expose files outside the upload dir.
  const [real, realDir] = await Promise.all([realpath(target.path), realpath(target.dir)]).catch(() => []);
  const st = real && inside(realDir, real) ? await stat(real).catch(() => null) : null;
  if (!st?.isFile()) return Response.json({ error: "File not found" }, { status: 404 });
  return new Response(Bun.file(real), { headers: {
    "Content-Disposition": attachment(target.name),
    "Content-Security-Policy": "sandbox; default-src 'none'"
  } });
}
