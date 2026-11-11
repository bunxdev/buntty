import { resolve, sep } from "node:path";
import { uploadDir as _uploadDir, UPLOAD_ROOT, inside } from "./state.js";

export { UPLOAD_ROOT };
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const uploadDir = _uploadDir;

export function uploadPath(sessionId, name) {
  const dir = uploadDir(sessionId), safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 200);
  if (!safe || safe === "." || safe === "..") return null;
  const p = resolve(dir, safe);
  return inside(dir, p) && p !== dir ? { dir, path: p, name: safe } : null;
}
