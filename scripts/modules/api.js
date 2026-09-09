import { state } from "./state.js";
import { writeToSession } from "./session.js";
import { getClientsForSession, broadcastControlChanged } from "./clients.js";
import { validInput } from "./validation.js";

export function handleStatus(sessionId) {
  const session = state.sessions.get(sessionId);
  return Response.json({ active: !!session, sessionId, archiveError: session?.archiveError ?? false, commandTracking: session?.commandTracking ?? false,
    clients: getClientsForSession(sessionId).map(c => ({ id: c.id, name: c.name, isController: c.id === session?.controllerId })),
    controller: session?.controllerId ?? null });
}

export async function handleInput(req, sessionId) {
  const body = await req.json().catch(() => null);
  return !validInput(body?.data) ? Response.json({ error: "data must be a nonempty string of at most 65536 characters" }, { status: 400 })
    : !state.sessions.get(sessionId) || state.sessions.get(sessionId).terminal.closed ? Response.json({ error: "No active session" }, { status: 400 })
    : state.sessions.get(sessionId).controllerId !== 0 ? Response.json({ error: "API does not have control; call /api/take-control first" }, { status: 409 })
    : (writeToSession(sessionId, body.data), Response.json({ ok: true, sessionId }));
}

export function handleTakeControl(sessionId) {
  const session = state.sessions.get(sessionId);
  return !session ? Response.json({ error: "No active session" }, { status: 400 })
    : (session.controllerId = 0, broadcastControlChanged(sessionId, 0, "AI"), Response.json({ ok: true, sessionId, controllerId: 0 }));
}
