import { serve } from "bun";
import { handleStatus, handleInput, handleTakeControl } from "./modules/api.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";
import { handleLogs } from "./modules/archive.js";

const server = serve({ port: Number(process.env.PORT || 3000), hostname: process.env.HOST || "0.0.0.0",
  maxRequestBodySize: 1_048_576,
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    if (u.pathname === "/ws" || u.pathname.startsWith("/api/")) {
      const origin = req.headers.get("origin");
      if (origin) {
        try { if (new URL(origin).host !== u.host) return new Response("Origin not allowed", { status: 403 }); }
        catch { return new Response("Invalid origin", { status: 403 }); }
      }
    }
    if (u.pathname === "/ws") {
      return server.upgrade(req, { data: { url: req.url } }) ? undefined : new Response("WebSocket upgrade required", { status: 400 });
    }
    return u.pathname.startsWith("/public/") ? new Response(Bun.file(`.${u.pathname}`), { headers: { "Cache-Control": "no-cache" } })
      : u.pathname === "/api/status" ? handleStatus(sessionId)
      : u.pathname === "/api/logs" && req.method === "GET" ? handleLogs(u, sessionId)
      : u.pathname === "/api/input" && req.method === "POST" ? handleInput(req, sessionId)
      : u.pathname === "/api/take-control" && req.method === "POST" ? handleTakeControl(sessionId)
      : req.method === "GET" ? new Response(Bun.file("./public/index.html"), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } })
      : new Response("Not Found", { status: 404 });
  },
  websocket: { open: onOpen, message: onMessage, close: onClose,
    maxPayloadLength: 262_144, backpressureLimit: 16_777_216, closeOnBackpressureLimit: true },
});

console.log(`\n  BunTTY v4.0 | http://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | Path sessions\n`);

export default server;
