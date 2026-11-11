import { getTerminal } from "./terminal.js";
const $ = (id) => document.getElementById(id);
let toastTimer = null;

export function showToast(text, type = "info", dur = 3000) {
  const el = $("toast"); el.textContent = text; el.className = `toast ${type} show`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

export function updateUI(myId, cid, readonly = false, clients = []) {
  const isMe = cid === myId, isAI = cid === 0, t = getTerminal(), s = $("status"), btn = $("btnControl");
  const other = clients.find((c) => c.id === cid);
  s.textContent = readonly ? "Solo lectura"
    : isMe ? "Tienes el control"
    : isAI ? "Controla la IA"
    : cid == null ? "Nadie tiene el control"
    : `Controla ${other?.name || "otro usuario"}`;
  s.className = "bar-status " + (readonly ? "readonly" : (isMe || isAI ? "on" : "off"));
  t.element.style.opacity = readonly ? "0.9" : (isMe || isAI) ? "1" : "0.85";
  btn.textContent = readonly ? "Solo lectura" : isMe ? "Soltar" : "Tomar control";
  btn.title = readonly ? "Modo solo lectura" : isMe ? "Soltar el control del terminal" : "Tomar el control del terminal";
  btn.className = "bar-btn" + (readonly ? " readonly" : isMe ? " active" : "");
  btn.disabled = readonly;
  btn.setAttribute("aria-pressed", String(isMe));
}

export function renderUsers(list, myId, released = false) {
  const box = $("users");
  box.replaceChildren(...list.map((u) => {
    const el = document.createElement("span");
    const isAI = u.id === 0, isSelf = u.id === myId;
    el.className = "user-badge" + (isAI ? " ai" : isSelf ? " self" : "")
      + (u.isController ? " controller" : "") + (u.isController && released ? " released" : "");
    el.textContent = isAI ? "IA" : isSelf ? `${u.name} (tú)` : u.name;
    el.title = (isAI ? "IA" : u.name) + (u.isController ? " — tiene el control" : "");
    return el;
  }));
}

export function showOverlay(msg, btn = false) {
  $("overlayMsg").textContent = msg;
  $("overlayBtn").hidden = !btn;
  $("overlay").classList.add("active");
  if (btn) $("overlayBtn").focus();
}

export const hideOverlay = () => $("overlay").classList.remove("active");
