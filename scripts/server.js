import { serve } from "bun";
import pug from "pug";
import { handleStatus, handleInput, handleTakeControl } from "./modules/api.js";
import { onOpen, onMessage, onClose } from "./modules/handlers.js";
import { normalizeSessionId } from "./modules/state.js";

const agentsConfig = JSON.parse(require("fs").readFileSync("./agents/agents.json", "utf8"));
const gridRender = pug.compileFile("./views/grid.pug");

const server = serve({ port: Number(process.env.PORT) || 3000, hostname: "0.0.0.0",
  async fetch(req, server) {
    const u = new URL(req.url), sessionId = normalizeSessionId(u.searchParams.get("session"));
    return u.pathname === "/ws" ? (server.upgrade(req, { data: { url: req.url } }), new Response(null))
      : u.pathname.startsWith("/public/") ? new Response(Bun.file(`.${u.pathname}`))
      : u.pathname === "/grid" ? new Response(gridRender({ agents: agentsConfig.agents }), { headers: { "Content-Type": "text/html" } })
      : u.pathname === "/api/status" ? handleStatus(sessionId)
      : u.pathname === "/api/input" && req.method === "POST" ? handleInput(req, sessionId)
      : u.pathname === "/api/take-control" && req.method === "POST" ? handleTakeControl(sessionId)
      : req.method === "GET" ? new Response(Bun.file("./public/index.html"), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } })
      : new Response("Not Found", { status: 404 });
  },
  websocket: { open: onOpen, message: onMessage, close: onClose },
});

console.log(`\n  BunTTY v4.0 | http://${server.hostname}:${server.port} | Shell: ${process.env.SHELL || "bash"} | Path sessions\n`);
