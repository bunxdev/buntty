import { resolve, sep } from "node:path";

export const state = {
  sessions: new Map(),
  clients: new Map(),
  nextId: 1,
};

export const UPLOAD_ROOT = "/tmp/buntty-uploads";
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

export function normalizeSessionId(value = "/") {
  const id = String(value || "/").trim().replace(/^\/+|\/+$/g, "");
  if (!id) return "/";
  if (id.length > 128) return null;
  const parts = id.split("/");
  return parts.length <= 4 && parts.every(p => SEGMENT.test(p)) ? `/${id}` : null;
}

export const inside = (dir, child) => child === dir || child.startsWith(dir + sep);

export function uploadDir(sessionId) {
  if (typeof sessionId !== "string") throw new Error("Invalid session");
  const dir = resolve(UPLOAD_ROOT, sessionId.replace(/^\//, "") || "default");
  if (!inside(UPLOAD_ROOT, dir)) throw new Error("Invalid session");
  return dir;
}

export const sanitizeName = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f<>"'`&]/g, "").trim().slice(0, 32) || null;
