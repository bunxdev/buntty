import { resolve, sep } from "node:path";
import { mkdirSync, lstatSync, chmodSync } from "node:fs";

export const state = {
  sessions: new Map(),
  clients: new Map(),
  nextId: 1,
};

export const UPLOAD_ROOT = resolve(process.env.BT_UPLOAD_ROOT || "/tmp/buntty-uploads");

export function ensureUploadRoot() {
  try { mkdirSync(UPLOAD_ROOT, { recursive: true, mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
  const st = lstatSync(UPLOAD_ROOT);
  if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid()))
    throw new Error(`${UPLOAD_ROOT} is a symlink or not owned by this user`);
  chmodSync(UPLOAD_ROOT, 0o700);
}
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
  // Flat, collision-free dir per session: "/" -> "+root", "/a/b" -> "a+b". "+" never appears in a
  // segment, so "/" can't share a dir with "/default" and "/a" can't contain the dir of "/a/b".
  const id = sessionId.replace(/^\/+/, "");
  const dir = resolve(UPLOAD_ROOT, id ? id.replaceAll("/", "+") : "+root");
  if (!inside(UPLOAD_ROOT, dir)) throw new Error("Invalid session");
  return dir;
}

export const sanitizeName = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f<>"'`&]/g, "").trim().slice(0, 32) || null;
