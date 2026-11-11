import { state, inside } from "./state.js";
import { createSession, destroySession, writeToSession, recordEvent, recordingFull, MAX_SESSIONS, MAX_RECORDING_EVENTS, MAX_RECORDING_BYTES } from "./session.js";
import { getClientsForSession, broadcast, broadcastControlChanged } from "./clients.js";
import { handOffControl, applySize, announceUpload } from "./handlers.js";
import { uploadDir, uploadPath, saveUpload, MAX_UPLOAD_BYTES } from "./uploads.js";
import { readdir, realpath, stat } from "node:fs/promises";

const noSession = () => Response.json({ error: "No active session" }, { status: 404 });
const liveSession = (id) => { const s = state.sessions.get(id); return s && !s.terminal.closed ? s : null; };
const fileStem = (sessionId) => `buntty-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "") || "root"}-${Date.now()}`;
const fileUrl = (sessionId, name) => `/api/files?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(name)}`;
const MAX_JSON_BYTES = 1024 * 1024;
// Parse a JSON body, enforcing Content-Type and a size cap even for chunked bodies without Content-Length.
async function readJson(req) {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json"))
    return { error: Response.json({ error: "Content-Type must be application/json" }, { status: 415 }) };
  const text = await req.text().catch(() => "");
  if (text.length > MAX_JSON_BYTES) return { error: Response.json({ error: "Request body too large" }, { status: 413 }) };
  try { return { body: JSON.parse(text) }; } catch { return { error: Response.json({ error: "Invalid JSON body" }, { status: 400 }) }; }
}
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
const summary = (s) => ({ id: s.id, pid: s.proc?.pid ?? null,
  active: !s.terminal.closed, controller: s.controllerId ?? null, clients: getClientsForSession(s.id).length,
  cols: s.size?.cols ?? s.recordingHeader.width, rows: s.size?.rows ?? s.recordingHeader.height,
  createdAt: new Date(s.createdAt).toISOString() });

export function handleSessions() {
  return Response.json({ sessions: [...state.sessions.values()].map(summary) });
}

// Idempotent: 201 when a shell was spawned, 200 when the session already existed.
// Scripts can call this before /api/input instead of needing a browser to open the session first.
export function handleCreateSession(sessionId) {
  const existing = liveSession(sessionId);
  if (existing) return Response.json({ created: false, session: summary(existing) });
  if (state.sessions.size >= MAX_SESSIONS) return Response.json({ error: "Too many sessions", max: MAX_SESSIONS }, { status: 503 });
  const session = createSession(sessionId, null);
  console.log(`[BunTTY] API created session ${sessionId}`);
  return Response.json({ created: true, session: summary(session) }, { status: 201 });
}

// Kill the shell. Connected clients get the same session_ended they'd see if it exited on its own.
export function handleDeleteSession(sessionId) {
  if (!state.sessions.has(sessionId)) return noSession();
  broadcast(sessionId, { type: "session_ended" });
  destroySession(sessionId);
  console.log(`[BunTTY] API killed session ${sessionId}`);
  return Response.json({ ok: true, sessionId });
}

export function handleDownload(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return noSession();
  return new Response(Bun.stripANSI(session.history || ""), { headers: {
    "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": attachment(`${fileStem(sessionId)}.log`) } });
}

export async function handleInput(req, sessionId) {
  const { body, error } = await readJson(req);
  if (error) return error;
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

// Only the controller's viewport drives the PTY (see handlers.js), so the API may resize only
// while no human holds control: after take-control, or on a headless session.
export async function handleResize(req, sessionId) {
  const { body, error } = await readJson(req);
  if (error) return error;
  const ok = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
  if (!ok(body?.cols, 500) || !ok(body?.rows, 200)) return Response.json({ error: "cols (1-500) and rows (1-200) must be integers" }, { status: 400 });
  const session = liveSession(sessionId);
  if (!session) return noSession();
  if (session.controllerId != null && session.controllerId !== 0)
    return Response.json({ error: "A user holds control; call take-control first", controllerId: session.controllerId }, { status: 409 });
  applySize(session, { cols: body.cols, rows: body.rows });
  return Response.json({ ok: true, sessionId, cols: body.cols, rows: body.rows });
}

// Raw-body upload: curl --data-binary @file 'http://host/api/upload?session=%2F1&name=file.txt'
export async function handleUpload(req, sessionId, name) {
  if (!name) return Response.json({ error: "Missing name parameter" }, { status: 400 });
  if (!state.sessions.has(sessionId)) return noSession();
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES) return Response.json({ error: "File exceeds 10MB limit" }, { status: 413 });
  const buf = Buffer.from(await req.arrayBuffer());
  try {
    const saved = await saveUpload(sessionId, name, buf);
    announceUpload(sessionId, saved.path, saved.size);
    console.log(`[BunTTY] API uploaded ${saved.name} (${saved.size} bytes) to ${saved.path}`);
    return Response.json({ ok: true, sessionId, ...saved, url: fileUrl(sessionId, saved.name) }, { status: 201 });
  } catch (err) {
    if (err.message === "Invalid filename") return Response.json({ error: "Invalid file name" }, { status: 400 });
    if (err.message === "File exceeds 10MB limit") return Response.json({ error: err.message }, { status: 413 });
    throw err;
  }
}

export async function handleUploads(sessionId) {
  const dir = uploadDir(sessionId);
  try {
    // Only list regular files whose names survive uploadPath() unchanged, so every listed url downloads.
    const entries = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && uploadPath(sessionId, e.name)?.name === e.name);
    const files = await Promise.all(entries.map(async (e) => {
      const f = Bun.file(`${dir}/${e.name}`), st = await f.stat();
      return { name: e.name, size: st.size, modified: st.mtime.toISOString(), type: f.type,
        url: fileUrl(sessionId, e.name) };
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
