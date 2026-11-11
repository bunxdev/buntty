export const state = {
  sessions: new Map(),
  clients: new Map(),
  nextId: 1,
};

export function normalizeSessionId(value = "/") {
  const id = String(value || "/").trim().replace(/^\/+|\/+$/g, "").slice(0, 128);
  return id ? `/${id}` : "/";
}
