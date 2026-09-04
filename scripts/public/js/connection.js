let ws = null, cb = null;

export function connect(onOpen, onMessage, onClose) {
  const p = location.protocol === "https:" ? "wss:" : "ws:",
    n = localStorage.getItem("buntty_name") || "User" + Math.floor(Math.random() * 9000 + 1000),
    session = location.pathname.replace(/\/+$/, "") || "/";
  localStorage.setItem("buntty_name", n); cb = onMessage;
  ws = new WebSocket(`${p}//${location.host}/ws?name=${encodeURIComponent(n)}&session=${encodeURIComponent(session)}`);
  ws.onopen = onOpen;
  ws.onmessage = (e) => { const r = typeof e.data === "string" ? e.data : ""; try { cb(JSON.parse(r), null); } catch { cb(null, r); } };
  ws.onclose = onClose;
}

export function send(d) {
  ws && ws.readyState === WebSocket.OPEN && ws.send(typeof d === "string" ? d : JSON.stringify(d));
}

export const getSocket = () => ws;
