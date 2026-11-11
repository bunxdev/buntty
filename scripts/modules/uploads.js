import { resolve } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

// Shared by the WebSocket and REST upload paths. Throws "Invalid filename" / "File exceeds 10MB limit".
export async function saveUpload(sessionId, name, buf) {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("File exceeds 10MB limit");
  const target = uploadPath(sessionId, name);
  if (!target) throw new Error("Invalid filename");
  await mkdir(target.dir, { recursive: true });
  // Write to a hidden temp file and rename over the target: rename replaces a symlink planted at
  // dest instead of writing through it, and readers never see a half-written file.
  const tmp = `${target.dir}/.upload-${randomUUID()}`;
  try { await Bun.write(tmp, buf); await rename(tmp, target.path); }
  catch (err) { await unlink(tmp).catch(() => {}); throw err; }
  return { name: target.name, path: target.path, size: buf.length };
}
