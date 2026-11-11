import { state } from "./state.js";
import { broadcast } from "./clients.js";

const MAX_HISTORY_LENGTH = 2_000_000;
const MAX_RECORDING_EVENTS = 50_000;
const appendHistory = (history, output) => (history + output).slice(-MAX_HISTORY_LENGTH);

export function createSession(sessionId, clientId) {
  if (state.sessions.has(sessionId)) return state.sessions.get(sessionId);
  let session = null, pendingHistory = "";
  const cols = Number(process.env.BT_COLS) || 80, rows = Number(process.env.BT_ROWS) || 24;
  const proc = Bun.spawn([process.env.SHELL || "bash"], { terminal: { cols, rows,
    data: (_, d) => { const output = d.toString(); if (!output) return;
      if (!session) return void (pendingHistory = appendHistory(pendingHistory, output));
      session.history = appendHistory(session.history, output);
      if (session.recording.length < MAX_RECORDING_EVENTS) session.recording.push([(Date.now() - session.createdAt) / 1000, "o", output]);
      broadcast(sessionId, { type: "output", data: output }); },
    exit: (_, c, sig) => { broadcast(sessionId, { type: "exit", code: c, signal: sig }); broadcast(sessionId, { type: "session_ended" }); destroySession(sessionId); },
  }, env: { ...process.env, TERM: "xterm-256color" } });
  const now = Date.now();
  session = { id: sessionId, terminal: proc.terminal, proc, controllerId: clientId, createdAt: now, history: pendingHistory,
    recording: [], recordingHeader: { version: 2, width: cols, height: rows, timestamp: Math.floor(now / 1000), env: { SHELL: process.env.SHELL || "bash", TERM: "xterm-256color" } } };
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
