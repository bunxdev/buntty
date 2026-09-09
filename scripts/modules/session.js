import { state } from "./state.js";
import { broadcast } from "./clients.js";
import { Archive, CommandStream } from "./archive.js";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_HISTORY_LENGTH = Number(process.env.BUNTTY_HISTORY_CHARS || 8_000_000);
if (!Number.isSafeInteger(MAX_HISTORY_LENGTH) || MAX_HISTORY_LENGTH < 1) {
  throw new Error("BUNTTY_HISTORY_CHARS must be a positive safe integer");
}
const appendHistory = (history, output) => (history + output).slice(-MAX_HISTORY_LENGTH);

export function createSession(sessionId, clientId) {
  if (state.sessions.has(sessionId)) return state.sessions.get(sessionId);
  const decoder = new TextDecoder();
  let session = null, pendingHistory = "", archive = null;
  const token = randomUUID(), shell = process.env.SHELL || "bash";
  const tracking = basename(shell) === "bash";
  const archiveError = error => {
    console.error(`[BunTTY] Logs ${sessionId}: ${error.message}`);
    try { archive?.close(); } catch {}
    archive = null;
    if (session) session.archiveError = true;
    broadcast(sessionId, { type: "error", message: "No se pudo guardar el historial en disco." });
  };
  try { archive = new Archive(sessionId); } catch (error) { archiveError(error); }
  const save = (method, value) => { try { archive?.[method](value); } catch (error) { archiveError(error); } };
  const output = data => {
    if (!data) return;
    save("output", data);
    if (!session) return void (pendingHistory = appendHistory(pendingHistory, data));
    session.history = appendHistory(session.history, data);
    broadcast(sessionId, { type: "output", data });
  };
  const stream = new CommandStream(token, output, command => save("start", command), code => save("end", code));
  const args = tracking ? [shell, "--rcfile", new URL("./bashrc.sh", import.meta.url).pathname, "-i"] : [shell];
  const proc = Bun.spawn(args, { terminal: { cols: 80, rows: 24,
    data: (_, d) => stream.push(decoder.decode(d, { stream: true })),
    exit: (_, c, sig) => {
      stream.push(decoder.decode()); stream.flush(); save("close");
      if (state.sessions.get(sessionId) !== session) return;
      broadcast(sessionId, { type: "exit", code: c, signal: sig });
      broadcast(sessionId, { type: "session_ended" }); destroySession(sessionId);
    },
  }, env: { ...process.env, TERM: "xterm-256color", BUNTTY_LOG_TOKEN: token } });
  session = { id: sessionId, terminal: proc.terminal, proc, controllerId: clientId, createdAt: Date.now(), history: pendingHistory, closeArchive: () => { stream.flush(); save("close"); }, archiveError: !archive, commandTracking: tracking };
  state.sessions.set(sessionId, session);
  console.log(`[BunTTY] Session ${sessionId} created (PID: ${proc.pid})`);
  return session;
}

export function destroySession(sessionId) {
  const session = state.sessions.get(sessionId); if (!session) return;
  state.sessions.delete(sessionId);
  session.closeArchive?.();
  try { session.terminal && !session.terminal.closed && session.terminal.close(); session.proc && session.proc.kill(); } catch {}
}

export function writeToSession(sessionId, d) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.write(d); }
export function resizeSession(sessionId, c, r) { const session = state.sessions.get(sessionId); session && !session.terminal.closed && session.terminal.resize(c, r); }
