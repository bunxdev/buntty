import { state } from "./state.js";
import { broadcast } from "./clients.js";

const MAX_HISTORY_LENGTH = 2_000_000;
const appendHistory = (history, output) => (history + output).slice(-MAX_HISTORY_LENGTH);

export function createSession(sessionId, clientId) {
  if (state.sessions.has(sessionId)) return state.sessions.get(sessionId);
  let session = null, pendingHistory = "";
  const proc = Bun.spawn([process.env.SHELL || "bash"], { terminal: { cols: Number(process.env.BT_COLS) || 80, rows: Number(process.env.BT_ROWS) || 24,
    data: (_, d) => { const output = d.toString(); if (!output) return;
      if (!session) return void (pendingHistory = appendHistory(pendingHistory, output));
      session.history = appendHistory(session.history, output); broadcast(sessionId, { type: "output", data: output }); },
    exit: (_, c, sig) => { broadcast(sessionId, { type: "exit", code: c, signal: sig }); broadcast(sessionId, { type: "session_ended" }); destroySession(sessionId); },
  }, env: { ...process.env, TERM: "xterm-256color" } });
  session = { id: sessionId, terminal: proc.terminal, proc, controllerId: clientId, createdAt: Date.now(), history: pendingHistory };
  state.sessions.set(sessionId, session);
  console.log(`[BunTTY] Session ${sessionId} created (PID: ${proc.pid})`);
  return session;
}

export function destroySession(sessionId) {
  const session = state.sessions.get(sessionId); if (!session) return;
  state.sessions.delete(sessionId);
  try { session.terminal && !session.terminal.closed && session.terminal.close(); session.proc && session.proc.kill(); } catch {}
}

export function writeToSession(sessionId, d) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.write(d); }
export function resizeSession(sessionId, c, r) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.resize(c, r); }
