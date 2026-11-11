import { state } from "./state.js";
import { broadcast } from "./clients.js";

const MAX_HISTORY_LENGTH = 2_000_000;
// Trim lazily: Bun concatenates strings as ropes, so slicing on every chunk would copy ~2MB per output event.
const HISTORY_SLACK = 256_000;
export const MAX_RECORDING_EVENTS = 50_000;
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const appendHistory = (history, output) => {
  const h = history + output;
  return h.length > MAX_HISTORY_LENGTH + HISTORY_SLACK ? h.slice(-MAX_HISTORY_LENGTH) : h;
};

// Append an asciicast v2 event; stops silently once the event or byte cap is hit (see recordingFull).
export function recordEvent(session, type, data) {
  if (recordingFull(session)) return;
  session.recording.push([(Date.now() - session.createdAt) / 1000, type, data]);
  session.recordingBytes += data.length;
}
export const recordingFull = (s) => s.recording.length >= MAX_RECORDING_EVENTS || s.recordingBytes >= MAX_RECORDING_BYTES;

export function createSession(sessionId, clientId) {
  if (state.sessions.has(sessionId)) return state.sessions.get(sessionId);
  // Streaming decoder: a multi-byte UTF-8 char split across PTY chunks must not become U+FFFD.
  let session = null, pendingHistory = "";
  const decoder = new TextDecoder();
  const cols = Number(process.env.BT_COLS) || 80, rows = Number(process.env.BT_ROWS) || 24;
  const proc = Bun.spawn([process.env.SHELL || "bash"], { terminal: { cols, rows,
    data: (_, d) => { const output = decoder.decode(d, { stream: true }); if (!output) return;
      if (!session) return void (pendingHistory = appendHistory(pendingHistory, output));
      session.history = appendHistory(session.history, output);
      recordEvent(session, "o", output);
      broadcast(sessionId, { type: "output", data: output }); },
    exit: (_, c, sig) => { if (session && state.sessions.get(sessionId) !== session) return; // stale exit from a replaced session
      broadcast(sessionId, { type: "exit", code: c, signal: sig }); broadcast(sessionId, { type: "session_ended" }); destroySession(sessionId); },
  }, env: { ...process.env, TERM: "xterm-256color" } });
  const now = Date.now();
  session = { id: sessionId, terminal: proc.terminal, proc, controllerId: clientId, createdAt: now, history: pendingHistory,
    recording: [], recordingBytes: 0, recordingHeader: { version: 2, width: cols, height: rows, timestamp: Math.floor(now / 1000), env: { SHELL: process.env.SHELL || "bash", TERM: "xterm-256color" } } };
  state.sessions.set(sessionId, session);
  console.log(`[BunTTY] Session ${sessionId} created (PID: ${proc.pid}, recording: on)`);
  return session;
}

export function destroySession(sessionId) {
  const session = state.sessions.get(sessionId); if (!session) return;
  state.sessions.delete(sessionId);
  try { session.terminal && !session.terminal.closed && session.terminal.close(); session.proc && session.proc.kill(); } catch {}
}

export function writeToSession(sessionId, d) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.write(d); }
export function resizeSession(sessionId, c, r) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.resize(c, r); }
