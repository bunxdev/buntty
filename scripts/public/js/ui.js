import { getTerminal } from "./terminal.js";
const $ = (id) => document.getElementById(id);
let toastTimer = null;

export function showToast(text, type = "info", dur = 3000) {
  const el = $("toast"); el.textContent = text; el.className = `toast ${type} show`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

export function updateUI(myId, cid) {
  const isMe = myId !== null && cid === myId, isAI = cid === 0, t = getTerminal(), s = $("status");
  s.textContent = myId === null ? "Desconectado" : isAI ? "IA al control" : isMe ? "Tienes el control" : cid === null ? "Sin controlador" : "Solo lectura";
  s.className = "bar-status " + (myId !== null ? "on" : "off");
  t.options.disableStdin = !isMe; t.element.style.opacity = isMe ? "1" : "0.85";
  $("btnControl").disabled = myId === null;
  $("btnControl").textContent = isMe ? "Soltar" : "Control";
  $("btnControl").className = "bar-btn" + (isMe ? " active" : "");
}

export function renderUsers(list, myId) {
  $("users").replaceChildren(...list.map(user => {
    const badge = document.createElement("span");
    badge.className = `user-badge${user.id === myId ? " self" : ""}${user.isController ? " controller" : ""}`;
    badge.textContent = user.id === myId ? `${user.name} (tú)` : user.name;
    return badge;
  }));
}

export function showOverlay(msg, btn = false) {
  $("overlayMsg").textContent = msg; $("overlayBtn").style.display = btn ? "block" : "none"; $("overlay").classList.add("active");
}

export const hideOverlay = () => $("overlay").classList.remove("active");
