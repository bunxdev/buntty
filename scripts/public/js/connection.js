let ws = null, cb = null;

const pageParams = new URLSearchParams(location.search);

/** Current session id, derived from the URL path ("/1", "/" ...). */
export const sessionId = () => location.pathname.replace(/\/+$/, "") || "/";

/** Append ?token= (when the page was opened with one) so API calls pass BT_TOKEN auth. */
export function withToken(url) {
  const token = pageParams.get("token");
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

export function connect(onOpen, onMessage, onClose) {
  const p = location.protocol === "https:" ? "wss:" : "ws:",
    savedName = (() => { try { return localStorage.getItem("buntty_name"); } catch { return null; } })(),
    n = pageParams.get("agent") || savedName || "User" + Math.floor(Math.random() * 9000 + 1000);
  try { localStorage.setItem("buntty_name", n); } catch {}
  cb = onMessage;
  const q = new URLSearchParams({ name: n, session: sessionId() });
  if (pageParams.get("readonly") === "1") q.set("readonly", "1");
  ws = new WebSocket(withToken(`${p}//${location.host}/ws?${q}`));
  ws.onopen = onOpen;
  ws.onmessage = (e) => {
    const r = typeof e.data === "string" ? e.data : "";
    let msg;
    try { msg = JSON.parse(r); } catch { return cb(null, r); }
    cb(msg, null);
  };
  ws.onclose = onClose;
}

export function send(d) {
  ws && ws.readyState === WebSocket.OPEN && ws.send(typeof d === "string" ? d : JSON.stringify(d));
}

export const getSocket = () => ws;
