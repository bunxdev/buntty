import { resolve, sep } from "node:path";

export const UPLOAD_ROOT = "/tmp/buntty-uploads";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Map a session id to its own flat directory under UPLOAD_ROOT.
// Slashes and other specials become "_" so ids like "/.." or "/a/../../etc" can't escape the root.
export function uploadDir(sessionId) {
  const slug = String(sessionId).replace(/^\/+/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  return resolve(UPLOAD_ROOT, slug);
}

// Resolve a file inside a session's upload dir, or null if it would land outside it.
export function uploadPath(sessionId, name) {
  const dir = uploadDir(sessionId), safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  if (!safe || safe === "." || safe === "..") return null;
  const p = resolve(dir, safe);
  return p.startsWith(dir + sep) ? { dir, path: p, name: safe } : null;
}
