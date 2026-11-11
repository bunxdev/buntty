import { state, inside } from "./state.js";
import { writeToSession, recordEvent, recordingFull, MAX_RECORDING_EVENTS, MAX_RECORDING_BYTES } from "./session.js";
import { getClientsForSession, broadcastControlChanged } from "./clients.js";
import { handOffControl } from "./handlers.js";
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

// Tail of the output. ?chars=N (1..100000, default 4000) sets the size; ?strip=1 removes ANSI codes,
// which is what scripts/LLMs reading the screen usually want.
export function handleScreen(sessionId, u) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  const chars = Math.max(1, Math.min(100_000, Math.trunc(Number(u?.searchParams.get("chars"))) || 4000));
  const strip = u?.searchParams.get("strip") === "1";
  let screen = (session.history || "").slice(-chars);
  if (/^[\udc00-\udfff]/.test(screen)) screen = screen.slice(1); // don't start on half a surrogate pair
  if (strip) screen = Bun.stripANSI(screen);
  return Response.json({ sessionId, screen, stripped: strip });
}

// All live sessions, so API clients can discover ids instead of guessing them.
export function handleSessions() {
  const sessions = [...state.sessions.values()].map(s => ({ id: s.id, pid: s.proc?.pid ?? null,
    active: !s.terminal.closed, controller: s.controllerId ?? null, clients: getClientsForSession(s.id).length,
    cols: s.size?.cols ?? s.recordingHeader.width, rows: s.size?.rows ?? s.recordingHeader.height,
    createdAt: new Date(s.createdAt).toISOString() }));
  return Response.json({ sessions });
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
  const session = liveSession(sessionId);
  if (!session) return noSession();
  session.controllerId = 0;
  broadcastControlChanged(sessionId, 0, "AI");
  console.log(`[BunTTY] API took control of ${sessionId}`);
  return Response.json({ ok: true, sessionId, controllerId: 0 });
}

// Counterpart of take-control: hand the session back to the first connected writer (or nobody).
export function handleReleaseControl(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  if (session.controllerId !== 0) return Response.json({ error: "API does not hold control", controllerId: session.controllerId ?? null }, { status: 409 });
  handOffControl(session, sessionId, getClientsForSession(sessionId));
  console.log(`[BunTTY] API released control of ${sessionId}`);
  return Response.json({ ok: true, sessionId, controllerId: session.controllerId ?? null });
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
  // Stream in chunks instead of building one string of up to MAX_RECORDING_BYTES in memory.
  // Snapshot the length so events recorded mid-download don't make the file inconsistent.
  const events = session.recording, total = events.length, header = JSON.stringify(session.recordingHeader) + "\n";
  let i = 0;
  const body = new ReadableStream({ pull(ctrl) {
    if (i === -1) return ctrl.close();
    let chunk = i === 0 ? header : "";
    for (const end = Math.min(total, i + 1000); i < end; i++) chunk += JSON.stringify(events[i]) + "\n";
    if (i >= total) i = -1;
    ctrl.enqueue(chunk);
  } });
  return new Response(body, { headers: {
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
