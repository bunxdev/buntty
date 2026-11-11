let ws = null, cb = null;

export function connect(onOpen, onMessage, onClose) {
  const p = location.protocol === "https:" ? "wss:" : "ws:",
    params = new URLSearchParams(location.search),
    savedName = (() => { try { return localStorage.getItem("buntty_name"); } catch { return null; } })(),
    n = params.get("agent") || savedName || "User" + Math.floor(Math.random() * 9000 + 1000),
    session = location.pathname.replace(/\/+$/, "") || "/";
  try { localStorage.setItem("buntty_name", n); } catch {} cb = onMessage;
  ws = new WebSocket(`${p}//${location.host}/ws?name=${encodeURIComponent(n)}&session=${encodeURIComponent(session)}`);
  ws.onopen = onOpen;
  ws.onmessage = (e) => { const r = typeof e.data === "string" ? e.data : ""; try { cb(JSON.parse(r), null); } catch { cb(null, r); } };
  ws.onclose = onClose;
}

export function send(d) {
  ws && ws.readyState === WebSocket.OPEN && ws.send(typeof d === "string" ? d : JSON.stringify(d));
}

export const getSocket = () => ws;
