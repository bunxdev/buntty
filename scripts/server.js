import { serve } from "bun";
import pug from "pug";
import { handleStatus, handleInput, handleTakeControl, handleScreen, handleDownload, handleUploads, handleFileDownload, handleRecording, handleRecordingStatus } from "./modules/api.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";

const agentsConfig = JSON.parse(require("fs").readFileSync("./agents/agents.json", "utf8"));
const gridRender = pug.compileFile("./views/grid.pug");

const TOKEN = process.env.BT_TOKEN || "";
const checkAuth = (req) => {
  if (!TOKEN) return true;
  const h = req.headers.get("authorization") || "";
  const u = new URL(req.url);
  return h === `Bearer ${TOKEN}` || h === TOKEN || u.searchParams.get("token") === TOKEN;
};

const tlsOpts = process.env.BT_TLS_CERT && process.env.BT_TLS_KEY
  ? { cert: Bun.file(process.env.BT_TLS_CERT), key: Bun.file(process.env.BT_TLS_KEY) } : undefined;

const FRAME_ANCESTORS = process.env.BT_FRAME_ANCESTORS || "'self'";
const xFrame = FRAME_ANCESTORS === "'none'" ? "DENY" : FRAME_ANCESTORS === "'self'" ? "SAMEORIGIN" : "SAMEORIGIN";
const secHeaders = {
  "Content-Security-Policy": `frame-ancestors ${FRAME_ANCESTORS}`,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": xFrame,
};
const sec = (res) => { for (const [k, v] of Object.entries(secHeaders)) res.headers.set(k, v); return res; };

const server = serve({ port: Number(process.env.PORT) || 3000, hostname: "0.0.0.0", tls: tlsOpts,
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    if (u.pathname === "/ws") return server.upgrade(req, { data: { url: req.url } }), new Response(null);
    if (u.pathname.startsWith("/public/")) return sec(new Response(Bun.file(`.${u.pathname}`)));
    if (u.pathname === "/replay") return sec(new Response(Bun.file("./public/replay.html"), { headers: { "Content-Type": "text/html" } }));
    if (u.pathname === "/grid") {
      const cols = Number(u.searchParams.get("cols")) || 3, rows = Number(u.searchParams.get("rows")) || 2;
      return sec(new Response(gridRender({ agents: agentsConfig.agents, cols, rows }), { headers: { "Content-Type": "text/html" } }));
    }
    if (!checkAuth(req)) return sec(new Response("Unauthorized", { status: 401 }));
    const r = u.pathname === "/api/screen" ? handleScreen(sessionId)
      : u.pathname === "/api/status" ? handleStatus(sessionId)
      : u.pathname === "/api/download" ? handleDownload(sessionId)
      : u.pathname === "/api/uploads" ? handleUploads(sessionId)
      : u.pathname === "/api/files" ? handleFileDownload(sessionId, u.searchParams.get("file"))
      : u.pathname === "/api/recording" ? handleRecording(sessionId)
      : u.pathname === "/api/recording/status" ? handleRecordingStatus(sessionId)
      : u.pathname === "/api/input" && req.method === "POST" ? handleInput(req, sessionId)
      : u.pathname === "/api/take-control" && req.method === "POST" ? handleTakeControl(sessionId)
      : req.method === "GET" ? new Response(Bun.file("./public/index.html"), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } })
      : new Response("Not Found", { status: 404 });
    return sec(r instanceof Promise ? await r : r);
  },
  websocket: { open: onOpen, message: onMessage, close: onClose },
});

const proto = tlsOpts ? "https" : "http";
const cspCustom = FRAME_ANCESTORS !== "'self'";
const features = [TOKEN && "auth", tlsOpts && "tls", cspCustom && "csp"].filter(Boolean).join(", ") || "open";
console.log(`\n  BunTTY v5.3 | ${proto}://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | ${features} | rec: on\n`);
