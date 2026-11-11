import { serve } from "bun";
import pug from "pug";
import { hostname as osHostname } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { handleStatus, handleInput, handleTakeControl, handleScreen, handleDownload, handleUploads, handleFileDownload, handleRecording, handleRecordingStatus } from "./modules/api.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";

const agentsConfig = JSON.parse(require("fs").readFileSync("./agents/agents.json", "utf8"));
const gridRender = pug.compileFile("./views/grid.pug");
const PORT = Number(process.env.PORT) || 3000;

const TOKEN = process.env.BT_TOKEN || "";
const VIEW_TOKEN = process.env.BT_VIEW_TOKEN || "";
const COOKIE = `bt_auth_${PORT}`;
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookieToken = (req) => {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
};
const presentedToken = (req, u) => {
  const h = req.headers.get("authorization") || "";
  return (h.startsWith("Bearer ") ? h.slice(7) : h) || u.searchParams.get("token") || cookieToken(req);
};
const getRole = (req, u) => {
  if (!TOKEN && !VIEW_TOKEN) return "full";
  const t = presentedToken(req, u);
  if (!t) return null;
  if (TOKEN && safeEq(t, TOKEN)) return "full";
  if (VIEW_TOKEN && safeEq(t, VIEW_TOKEN)) return "view";
  return null;
};

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", osHostname(),
  ...(process.env.BT_ALLOWED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)]);
const ALLOWED_ORIGINS = new Set((process.env.BT_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean));
const hostOk = (req) => {
  if (TOKEN || VIEW_TOKEN) return true;
  const h = (req.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  return ALLOWED_HOSTS.has(h);
};
const originOk = (req) => {
  const o = req.headers.get("origin");
  if (!o) return true;
  if (ALLOWED_ORIGINS.has(o)) return true;
  try { return new URL(o).host === req.headers.get("host"); } catch { return false; }
};

const tlsOpts = process.env.BT_TLS_CERT && process.env.BT_TLS_KEY
  ? { cert: Bun.file(process.env.BT_TLS_CERT), key: Bun.file(process.env.BT_TLS_KEY) } : undefined;

const FRAME_ANCESTORS = process.env.BT_FRAME_ANCESTORS || "'self'";
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "frame-src 'self' http: https:",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
].join("; ");
const secHeaders = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
if (FRAME_ANCESTORS === "'none'") secHeaders["X-Frame-Options"] = "DENY";
else if (FRAME_ANCESTORS === "'self'") secHeaders["X-Frame-Options"] = "SAMEORIGIN";
// Route-specific headers win (e.g. /api/files sets a sandbox CSP for untrusted uploads).
const sec = (res) => { for (const [k, v] of Object.entries(secHeaders)) res.headers.has(k) || res.headers.set(k, v); return res; };
const deny = (msg, status) => sec(new Response(msg, { status }));
const html = (body) => new Response(body, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
const json = (body, status) => Response.json(body, { status });

const logSafe = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);
const secLog = (event, req, ip, extra = "") =>
  console.warn(`[BunTTY][SEC] ${new Date().toISOString()} ${event} ip=${logSafe(ip)} ${req.method} ${logSafe(new URL(req.url).pathname)} origin=${logSafe(req.headers.get("origin"))} host=${logSafe(req.headers.get("host"))} ${extra}`);

const AUTH_FAIL_LIMIT = 20, AUTH_FAIL_WINDOW = 5 * 60_000, authFails = new Map();
const authBlocked = (ip) => { const b = authFails.get(ip); return !!b && Date.now() - b.start < AUTH_FAIL_WINDOW && b.count >= AUTH_FAIL_LIMIT; };
const noteAuthFail = (ip) => {
  const now = Date.now(), b = authFails.get(ip);
  if (!b || now - b.start >= AUTH_FAIL_WINDOW) authFails.set(ip, { start: now, count: 1 }); else b.count++;
};
setInterval(() => { const now = Date.now(); for (const [k, b] of authFails) if (now - b.start >= AUTH_FAIL_WINDOW) authFails.delete(k); }, 60_000).unref?.();

const API = {
  "/api/screen": { GET: (_, s) => handleScreen(s) },
  "/api/status": { GET: (_, s) => handleStatus(s) },
  "/api/download": { GET: (_, s) => handleDownload(s) },
  "/api/uploads": { GET: (_, s) => handleUploads(s) },
  "/api/files": { GET: (_, s, u) => handleFileDownload(s, u.searchParams.get("file")) },
  "/api/recording": { GET: (_, s) => handleRecording(s), _full: true },
  "/api/recording/status": { GET: (_, s) => handleRecordingStatus(s) },
  "/api/input": { POST: (req, s) => handleInput(req, s), _full: true },
  "/api/take-control": { POST: (_, s) => handleTakeControl(s), _full: true },
};
const indexHtml = Bun.file("./public/index.html");

const server = serve({ port: PORT, hostname: "0.0.0.0", tls: tlsOpts, maxRequestBodySize: 1024 * 1024,
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    const ip = server.requestIP(req)?.address || "?";
    if (!hostOk(req)) return secLog("forbidden_host", req, ip), deny("Forbidden host", 403);
    if (u.pathname.startsWith("/public/")) {
      if (u.pathname.includes("..")) return deny("Forbidden", 403);
      const f = Bun.file(`.${u.pathname}`);
      return sec(await f.exists() ? new Response(f) : new Response("Not Found", { status: 404 }));
    }
    if (u.pathname === "/replay") return sec(html(Bun.file("./public/replay.html")));
    if (u.pathname === "/grid") {
      const dim = (k, def) => Math.max(1, Math.min(12, Math.trunc(Number(u.searchParams.get(k))) || def));
      const cols = dim("cols", 3), rows = dim("rows", 2);
      const host = req.headers.get("host") || "localhost:3000";
      return sec(new Response(gridRender({ agents: agentsConfig.agents, cols, rows, host, token: u.searchParams.get("token") || "" }), { headers: { "Content-Type": "text/html" } }));
    }
    if (authBlocked(ip)) return secLog("auth_rate_limited", req, ip), deny("Too Many Requests", 429);
    const role = getRole(req, u);
    if (!role) return noteAuthFail(ip), secLog("auth_failed", req, ip), deny("Unauthorized", 401);
    if (sessionId === null && (u.pathname === "/ws" || u.pathname.startsWith("/api/"))) return secLog("bad_session", req, ip), deny("Invalid session", 400);
    if (u.pathname === "/ws") {
      if (!originOk(req)) return secLog("forbidden_origin", req, ip), deny("Forbidden origin", 403);
      return server.upgrade(req, { data: { url: req.url, role } }) ? undefined : deny("Upgrade failed", 400);
    }
    if (req.method !== "GET" && !originOk(req)) return secLog("forbidden_origin", req, ip), deny("Forbidden origin", 403);
    if (req.method === "GET" && u.searchParams.has("token") && !u.pathname.startsWith("/api/")) {
      u.searchParams.delete("token");
      const secure = tlsOpts ? "; Secure" : "";
      return sec(new Response(null, { status: 302, headers: {
        Location: u.pathname.replace(/^\/+/, "/") + (u.search || ""),
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(presentedToken(req, new URL(req.url)))}; Path=/; HttpOnly; SameSite=Strict${secure}` } }));
    }
    let r;
    if (u.pathname.startsWith("/api/")) {
      const route = API[u.pathname.replace(/\/+$/, "")];
      const h = route?.[req.method] ?? (req.method === "HEAD" && route?.GET);
      if (!route) r = json({ error: "Not found" }, 404);
      else if (!h) r = new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", Allow: Object.keys(route).filter(k => !k.startsWith("_")).join(", ") } });
      else if (route._full && role !== "full") r = deny("Forbidden", 403);
      else r = await h(req, sessionId, u);
    } else if (req.method === "GET" || req.method === "HEAD") {
      r = new Response(indexHtml, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
    } else r = new Response("Not Found", { status: 404 });
    return sec(r);
  },
  development: false,
  error(err) {
    console.error(`[BunTTY][ERR] ${new Date().toISOString()} ${logSafe(err?.stack || err)}`);
    return sec(new Response("Internal Server Error", { status: 500 }));
  },
  websocket: { open: onOpen, message: onMessage, close: onClose, maxPayloadLength: 16 * 1024 * 1024 },
});

const proto = tlsOpts ? "https" : "http";
const features = [TOKEN && "auth", VIEW_TOKEN && "view-token", tlsOpts && "tls", FRAME_ANCESTORS !== "'self'" && "csp"].filter(Boolean).join(", ") || "open (host-pinned)";
console.log(`\n  BunTTY v5.3 | ${proto}://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | ${features} | rec: on\n`);
