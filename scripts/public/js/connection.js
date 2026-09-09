let ws = null, retryTimer = null, stopped = false;

export function connect(onOpen, onMessage, onClose) {
  disconnect();
  stopped = false;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:",
    name = localStorage.getItem("buntty_name") || "User" + Math.floor(Math.random() * 9000 + 1000),
    session = location.pathname.replace(/\/+$/, "") || "/";
  localStorage.setItem("buntty_name", name);
  let attempts = 0;
  const open = () => {
    if (stopped) return;
    const socket = new WebSocket(`${protocol}//${location.host}/ws?name=${encodeURIComponent(name)}&session=${encodeURIComponent(session)}`);
    ws = socket;
    socket.onopen = () => { if (ws === socket) onOpen(); };
    socket.onmessage = event => {
      if (ws !== socket || stopped) return;
      const raw = typeof event.data === "string" ? event.data : "";
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      if (message?.type === "welcome") attempts = 0;
      onMessage(message, null);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (stopped || ws !== socket) return;
      const delay = Math.min(1000 * 2 ** Math.min(attempts++, 5), 30_000);
      onClose(delay);
      retryTimer = setTimeout(open, delay);
    };
  };
  open();
}

export function disconnect() {
  stopped = true;
  clearTimeout(retryTimer);
  const previous = ws; ws = null;
  previous?.close();
}

export function send(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(typeof data === "string" ? data : JSON.stringify(data));
  return true;
}

export const getSocket = () => ws;
