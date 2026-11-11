import { resolve, sep } from "node:path";

export const state = {
  sessions: new Map(),
  clients: new Map(),
  nextId: 1,
};

export const UPLOAD_ROOT = "/tmp/buntty-uploads";
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

/** Returns "/" or "/seg[/seg...]" with safe segments, or null if the id is invalid (traversal, odd chars, too long). */
export function normalizeSessionId(value = "/") {
  const id = String(value || "/").trim().replace(/^\/+|\/+$/g, "");
  if (!id) return "/";
  if (id.length > 128) return null;
  const parts = id.split("/");
  return parts.length <= 4 && parts.every(p => SEGMENT.test(p)) ? `/${id}` : null;
}

/** True if `child` is `dir` itself or strictly inside it. */
export const inside = (dir, child) => child === dir || child.startsWith(dir + sep);

/** Upload directory for a validated session id, guaranteed to stay inside UPLOAD_ROOT. */
export function uploadDir(sessionId) {
  if (typeof sessionId !== "string") throw new Error("Invalid session");
  const dir = resolve(UPLOAD_ROOT, sessionId.replace(/^\//, "") || "default");
  if (!inside(UPLOAD_ROOT, dir)) throw new Error("Invalid session");
  return dir;
}
export const uploadDirFor = uploadDir;

/** Display names come from untrusted clients: strip control/HTML chars, cap length. */
export const sanitizeName = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f<>"'`&]/g, "").trim().slice(0, 32) || null;
