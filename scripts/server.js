import { serve } from "bun";
import pug from "pug";
import { hostname as osHostname } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { handleStatus, handleInput, handleTakeControl, handleReleaseControl, handleSessions, handleCreateSession, handleDeleteSession, handleResize, handleUpload, handleScreen, handleDownload, handleUploads, handleFileDownload, handleRecording, handleRecordingStatus } from "./modules/api.js";
import { MAX_UPLOAD_BYTES } from "./modules/uploads.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";

const agentsConfig = JSON.parse(require("fs").readFileSync("./agents/agents.json", "utf8"));
const gridRender = pug.compileFile("./views/grid.pug");
const PORT = Number(process.env.PORT) || 3000;

const TOKEN = process.env.BT_TOKEN || "";
const VIEW_TOKEN = process.env.BT_VIEW_TOKEN || "";
const COOKIE = `bt_auth_${PORT}`;
// Fail closed on configs that silently weaken auth.
if (TOKEN && VIEW_TOKEN && TOKEN === VIEW_TOKEN) {
  console.error("[BunTTY][SEC] BT_VIEW_TOKEN equals BT_TOKEN: view-only users would get full shell access. Refusing to start.");
  process.exit(1);
}
for (const [name, t] of [["BT_TOKEN", TOKEN], ["BT_VIEW_TOKEN", VIEW_TOKEN]])
  if (t && t.length < 16) console.warn(`[BunTTY][SEC] ${name} is only ${t.length} chars; use 32+ random chars (e.g. openssl rand -hex 32).`);
if (VIEW_TOKEN && !TOKEN) console.warn("[BunTTY][SEC] BT_VIEW_TOKEN without BT_TOKEN: nobody can open a new shell (only full tokens may).");
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
// Without tokens the Host header is the only gate, and clients control it. Also require a
// loopback/private source address so an exposed port never hands a shell to the internet.
const INSECURE_ANY_IP = process.env.BT_INSECURE_ANY_IP === "1";
const privateIp = (ip) => {
  const a = String(ip).toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^169\.254\./.test(a) || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe80:/.test(a);
};
const sourceOk = (ip) => TOKEN || VIEW_TOKEN || INSECURE_ANY_IP || privateIp(ip);
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
// Framing a root shell from any origin is clickjacking. The README forbids `*`; warn loudly
// if an operator set it, so the footgun isn't silent.
if (/(^|\s)\*(\s|$)/.test(FRAME_ANCESTORS)) console.warn("[BunTTY][SEC] BT_FRAME_ANCESTORS allows '*': ANY website can frame this root shell (clickjacking). Use explicit origins.");
// Allow only the CDN packages the pages load, not all of jsdelivr: otherwise any npm package
// (attacker-publishable) is a valid script source and an HTML injection becomes script execution.
const CDN = "https://cdn.jsdelivr.net/npm/@xterm/ https://cdn.jsdelivr.net/npm/asciinema-player@3.7.1/";
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${CDN} 'wasm-unsafe-eval'`,
  `style-src 'self' 'unsafe-inline' ${CDN}`,
  "img-src 'self' data: blob:",
  `font-src 'self' data: ${CDN}`,
  "connect-src 'self'",
  "frame-src 'self' http: https:",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
].join("; ");
const secHeaders = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none" };
if (tlsOpts) secHeaders["Strict-Transport-Security"] = "max-age=31536000";
if (FRAME_ANCESTORS === "'none'") secHeaders["X-Frame-Options"] = "DENY";
else if (FRAME_ANCESTORS === "'self'") secHeaders["X-Frame-Options"] = "SAMEORIGIN";
// Route-specific headers win (e.g. /api/files sets a sandbox CSP for untrusted uploads).
const sec = (res) => { for (const [k, v] of Object.entries(secHeaders)) res.headers.has(k) || res.headers.set(k, v); return res; };
// /api/* always answers JSON ({ error }) so API clients can parse every failure the same way.
const isApi = (path) => path === "/api" || path.startsWith("/api/");
const deny = (msg, status, path = "") => sec(isApi(path)
  ? Response.json({ error: msg }, { status, headers: status === 401 ? { "WWW-Authenticate": 'Bearer realm="BunTTY"' } : {} })
  : new Response(msg, { status }));
const html = (body) => new Response(body, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
const json = (body, status) => Response.json(body, { status });

const logSafe = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);
const secLog = (event, req, ip, extra = "") =>
  console.warn(`[BunTTY][SEC] ${new Date().toISOString()} ${event} ip=${logSafe(ip)} ${req.method} ${logSafe(new URL(req.url).pathname)} origin=${logSafe(req.headers.get("origin"))} host=${logSafe(req.headers.get("host"))} ${extra}`);

const AUTH_FAIL_LIMIT = 20, AUTH_FAIL_WINDOW = 5 * 60_000, authFails = new Map();
const authBlocked = (ip) => { const b = authFails.get(ip); return !!b && Date.now() - b.start < AUTH_FAIL_WINDOW && b.count >= AUTH_FAIL_LIMIT; };
const noteAuthFail = (ip) => {
  const now = Date.now(), b = authFails.get(ip);
  if (!b && authFails.size >= 10_000) authFails.delete(authFails.keys().next().value); // bound memory
  if (!b || now - b.start >= AUTH_FAIL_WINDOW) authFails.set(ip, { start: now, count: 1 }); else b.count++;
};
setInterval(() => { const now = Date.now(); for (const [k, b] of authFails) if (now - b.start >= AUTH_FAIL_WINDOW) authFails.delete(k); }, 60_000).unref?.();

// _full: needs the full-access token. _body: max request body in bytes (default API_BODY_LIMIT).
// _doc is served by GET /api so clients can discover the surface instead of reading the README.
const API_VERSION = "5.4", API_BODY_LIMIT = 1024 * 1024;
const API = {
  "/api/sessions": { GET: () => handleSessions(), POST: (_, s) => handleCreateSession(s), DELETE: (_, s) => handleDeleteSession(s), _full: ["POST", "DELETE"],
    _doc: "GET list live sessions; POST create ?session= (idempotent); DELETE kill ?session=" },
  "/api/screen": { GET: (_, s, u) => handleScreen(s, u), _doc: "Tail of the output (?chars=, ?strip=1)" },
  "/api/status": { GET: (_, s) => handleStatus(s), _doc: "Clients and controller of a session" },
  "/api/download": { GET: (_, s) => handleDownload(s), _doc: "Full output log as text (ANSI stripped)" },
  "/api/uploads": { GET: (_, s) => handleUploads(s), _doc: "List uploaded files" },
  "/api/upload": { POST: (req, s, u) => handleUpload(req, s, u.searchParams.get("name")), _full: true, _body: MAX_UPLOAD_BYTES,
    _doc: "Upload raw body as ?name= (max 10MB)" },
  "/api/files": { GET: (_, s, u) => handleFileDownload(s, u.searchParams.get("file")), _doc: "Download an uploaded file (?file=)" },
  "/api/recording": { GET: (_, s) => handleRecording(s), _full: true, _doc: "asciicast v2 recording (.cast)" },
  "/api/recording/status": { GET: (_, s) => handleRecordingStatus(s), _doc: "Recording counters and limits" },
  "/api/input": { POST: (req, s) => handleInput(req, s), _full: true, _doc: "Write {\"data\": string} to the shell" },
  "/api/resize": { POST: (req, s) => handleResize(req, s), _full: true, _doc: "Set PTY size {cols, rows} (409 while a user holds control)" },
  "/api/take-control": { POST: (_, s) => handleTakeControl(s), _full: true, _doc: "Lock out human typing; API becomes controller" },
  "/api/release-control": { POST: (_, s) => handleReleaseControl(s), _full: true, _doc: "Hand control back to the first connected writer" },
};
const methods = (route) => Object.keys(route).filter(k => !k.startsWith("_"));
const allowed = (route) => { const m = methods(route); return (m.includes("GET") ? [...m, "HEAD"] : m).join(", "); };
const needsFull = (route, method) => route._full === true || (Array.isArray(route._full) && route._full.includes(method));
const apiIndex = (role) => Response.json({ version: API_VERSION, role, routes: Object.entries(API).map(([path, r]) => ({
  path, methods: methods(r), full: methods(r).filter(m => needsFull(r, m)), description: r._doc })) });
const indexHtml = Bun.file("./public/index.html");

const server = serve({ port: PORT, hostname: "0.0.0.0", tls: tlsOpts, maxRequestBodySize: 16 * 1024 * 1024,
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    const ip = server.requestIP(req)?.address || "?";
    if (!sourceOk(ip)) return secLog("forbidden_source", req, ip), deny("Forbidden", 403, u.pathname);
    if (!hostOk(req)) return secLog("forbidden_host", req, ip), deny("Forbidden host", 403, u.pathname);
    if (u.pathname.startsWith("/public/")) {
      if (u.pathname.includes("..")) return deny("Forbidden", 403, u.pathname);
      const f = Bun.file(`.${u.pathname}`);
      return sec(await f.exists() ? new Response(f) : new Response("Not Found", { status: 404 }));
    }
    if (u.pathname === "/replay") return sec(html(Bun.file("./public/replay.html")));
    if (authBlocked(ip)) return secLog("auth_rate_limited", req, ip), deny("Too Many Requests", 429, u.pathname);
    const role = getRole(req, u);
    if (!role) return noteAuthFail(ip), secLog("auth_failed", req, ip), deny("Unauthorized", 401, u.pathname);
    if (sessionId === null && (u.pathname === "/ws" || isApi(u.pathname))) return secLog("bad_session", req, ip), deny("Invalid session", 400, u.pathname);
    if (u.pathname === "/grid") {
      const dim = (k, def) => Math.max(1, Math.min(12, Math.trunc(Number(u.searchParams.get(k))) || def));
      const cols = dim("cols", 3), rows = dim("rows", 2);
      const host = req.headers.get("host") || "localhost:3000";
      return sec(new Response(gridRender({ agents: agentsConfig.agents, cols, rows, host, token: u.searchParams.get("token") || "" }), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } }));
    }
    if (u.pathname === "/ws") {
      if (!originOk(req)) return secLog("forbidden_origin", req, ip), deny("Forbidden origin", 403, u.pathname);
      return server.upgrade(req, { data: { url: req.url, role, ip } }) ? undefined : deny("Upgrade failed", 400, u.pathname);
    }
    if (req.method !== "GET" && !originOk(req)) return secLog("forbidden_origin", req, ip), deny("Forbidden origin", 403, u.pathname);
    if (req.method === "GET" && u.searchParams.has("token") && !isApi(u.pathname)) {
      u.searchParams.delete("token");
      const secure = tlsOpts ? "; Secure" : "";
      return sec(new Response(null, { status: 302, headers: {
        Location: u.pathname.replace(/^\/+/, "/") + (u.search || ""),
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(presentedToken(req, new URL(req.url)))}; Path=/; HttpOnly; SameSite=Strict${secure}` } }));
    }
    let r;
    if (isApi(u.pathname)) {
      const path = u.pathname.replace(/\/+$/, "");
      const route = API[path];
      const h = route?.[req.method] ?? (req.method === "HEAD" && route?.GET);
      if (path === "/api" && (req.method === "GET" || req.method === "HEAD")) r = apiIndex(role);
      else if (!route) r = json({ error: "Not found" }, 404);
      else if (!h) r = new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", Allow: allowed(route) } });
      else if (needsFull(route, req.method) && role !== "full") r = deny("Requires a full-access token", 403, u.pathname);
      else if (Number(req.headers.get("content-length")) > (route._body ?? API_BODY_LIMIT)) r = json({ error: "Request body too large" }, 413);
      else {
        if (req.method !== "GET" && req.method !== "HEAD") secLog("api_" + u.pathname.slice(5).replace(/\W/g, "_"), req, ip, `role=${role} session=${logSafe(sessionId)}`);
        r = await h(req, sessionId, u);
      }
      r.headers.set("Cache-Control", "no-store");
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
  // A client that can't keep up is disconnected instead of silently dropping output (which would
  // leave its terminal garbled); on reconnect it gets a consistent copy from the history message.
  websocket: { open: onOpen, message: onMessage, close: onClose, maxPayloadLength: 16 * 1024 * 1024,
    backpressureLimit: 8 * 1024 * 1024, closeOnBackpressureLimit: true },
});

const proto = tlsOpts ? "https" : "http";
const features = [TOKEN && "auth", VIEW_TOKEN && "view-token", tlsOpts && "tls", FRAME_ANCESTORS !== "'self'" && "csp"].filter(Boolean).join(", ") || "open (host-pinned)";
if (!TOKEN && !VIEW_TOKEN) console.warn(`[BunTTY][SEC] No BT_TOKEN set: access limited to loopback/private IPs${INSECURE_ANY_IP ? " (DISABLED by BT_INSECURE_ANY_IP=1)" : ""}. Set BT_TOKEN before exposing this port.`);
console.log(`\n  BunTTY v${API_VERSION} | ${proto}://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | ${features} | rec: on\n`);
