import { serve } from "bun";
import pug from "pug";
import { handleStatus, handleInput, handleTakeControl, handleScreen, handleDownload, handleUploads, handleFileDownload, handleRecording, handleRecordingStatus } from "./modules/api.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";
import { timingSafeEqual } from "node:crypto";

const agentsConfig = JSON.parse(require("fs").readFileSync("./agents/agents.json", "utf8"));
const gridRender = pug.compileFile("./views/grid.pug");

const TOKEN = process.env.BT_TOKEN || "";
const TOKEN_BUF = Buffer.from(TOKEN);
const AUTH_COOKIE = "bt_token";
const tokenOk = (v) => { if (!v) return false; const b = Buffer.from(v); return b.length === TOKEN_BUF.length && timingSafeEqual(b, TOKEN_BUF); };
// Accepts header (Bearer or raw), ?token=, or the cookie set after a ?token= page load (lets the browser UI's
// fetch/WebSocket/window.open calls authenticate without threading the token through every URL).
const checkAuth = (req, u) => {
  if (!TOKEN) return true;
  const h = req.headers.get("authorization") || "";
  return tokenOk(h.startsWith("Bearer ") ? h.slice(7) : h) || tokenOk(u.searchParams.get("token"))
    || tokenOk(new Bun.CookieMap(req.headers.get("cookie") || "").get(AUTH_COOKIE));
};

const tlsOpts = process.env.BT_TLS_CERT && process.env.BT_TLS_KEY
  ? { cert: Bun.file(process.env.BT_TLS_CERT), key: Bun.file(process.env.BT_TLS_KEY) } : undefined;

const FRAME_ANCESTORS = process.env.BT_FRAME_ANCESTORS || "'self'";
const secHeaders = { "Content-Security-Policy": `frame-ancestors ${FRAME_ANCESTORS}`, "X-Content-Type-Options": "nosniff" };
if (FRAME_ANCESTORS === "'none'") secHeaders["X-Frame-Options"] = "DENY";
else if (FRAME_ANCESTORS === "'self'") secHeaders["X-Frame-Options"] = "SAMEORIGIN";
const sec = (res) => { for (const [k, v] of Object.entries(secHeaders)) res.headers.set(k, v); return res; };

const json = (body, status) => Response.json(body, { status });
// path -> { METHOD: handler(req, sessionId, url) }
const API = {
  "/api/screen": { GET: (_, s) => handleScreen(s) },
  "/api/status": { GET: (_, s) => handleStatus(s) },
  "/api/download": { GET: (_, s) => handleDownload(s) },
  "/api/uploads": { GET: (_, s) => handleUploads(s) },
  "/api/files": { GET: (_, s, u) => handleFileDownload(s, u.searchParams.get("file")) },
  "/api/recording": { GET: (_, s) => handleRecording(s) },
  "/api/recording/status": { GET: (_, s) => handleRecordingStatus(s) },
  "/api/input": { POST: (req, s) => handleInput(req, s) },
  "/api/take-control": { POST: (_, s) => handleTakeControl(s) },
};
const indexHtml = Bun.file("./public/index.html");

const server = serve({ port: Number(process.env.PORT) || 3000, hostname: "0.0.0.0", tls: tlsOpts,
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    if (u.pathname === "/ws") {
      if (!checkAuth(req, u)) return sec(new Response("Unauthorized", { status: 401 }));
      return server.upgrade(req, { data: { url: req.url } }) ? undefined : sec(new Response("WebSocket upgrade failed", { status: 400 }));
    }
    if (u.pathname.startsWith("/public/")) {
      if (u.pathname.includes("..")) return sec(new Response("Forbidden", { status: 403 }));
      const f = Bun.file(`.${u.pathname}`);
      return sec(await f.exists() ? new Response(f) : new Response("Not Found", { status: 404 }));
    }
    if (u.pathname === "/replay") return sec(new Response(Bun.file("./public/replay.html"), { headers: { "Content-Type": "text/html" } }));
    if (u.pathname === "/grid") {
      const dim = (k, def) => Math.max(1, Math.min(12, Math.trunc(Number(u.searchParams.get(k))) || def));
      const cols = dim("cols", 3), rows = dim("rows", 2);
      const host = req.headers.get("host") || "localhost:3000";
      return sec(new Response(gridRender({ agents: agentsConfig.agents, cols, rows, host, token: u.searchParams.get("token") || "" }), { headers: { "Content-Type": "text/html" } }));
    }
    if (!checkAuth(req, u)) return sec(u.pathname.startsWith("/api/") ? json({ error: "Unauthorized" }, 401) : new Response("Unauthorized", { status: 401 }));
    let r;
    if (u.pathname.startsWith("/api/")) {
      const route = API[u.pathname.replace(/\/+$/, "")];
      const h = route?.[req.method] ?? (req.method === "HEAD" && route?.GET);
      r = !route ? json({ error: "Not found" }, 404)
        : !h ? new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", Allow: Object.keys(route).join(", ") } })
        : await h(req, sessionId, u);
    } else if (req.method === "GET" || req.method === "HEAD") {
      r = new Response(indexHtml, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
      if (TOKEN && tokenOk(u.searchParams.get("token")))
        r.headers.append("Set-Cookie", `${AUTH_COOKIE}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict${tlsOpts ? "; Secure" : ""}`);
    } else r = new Response("Not Found", { status: 404 });
    return sec(r);
  },
  websocket: { open: onOpen, message: onMessage, close: onClose },
});

const proto = tlsOpts ? "https" : "http";
const cspCustom = FRAME_ANCESTORS !== "'self'";
const features = [TOKEN && "auth", tlsOpts && "tls", cspCustom && "csp"].filter(Boolean).join(", ") || "open";
console.log(`\n  BunTTY v5.3 | ${proto}://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | ${features} | rec: on\n`);
