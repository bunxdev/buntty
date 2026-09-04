import { getTerminal } from "./terminal.js";
const $ = (id) => document.getElementById(id);
let toastTimer = null;

export function showToast(text, type = "info", dur = 3000) {
  const el = $("toast"); el.textContent = text; el.className = `toast ${type} show`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

export function updateUI(myId, cid) {
  const isMe = cid === myId, isAI = cid === 0, t = getTerminal(), s = $("status");
  s.textContent = isAI ? "AI" : isMe ? "Humano" : "IA";
  s.className = "bar-status " + (isMe || isAI ? "on" : "off");
  t.readOnly = !isMe && !isAI; t.element.style.opacity = (isMe || isAI) ? "1" : "0.85";
  $("btnControl").textContent = isMe ? "Soltar" : "Control";
  $("btnControl").className = "bar-btn" + (isMe ? " active" : "");
}

export function renderUsers(list, myId, released = false) {
  $("users").innerHTML = list.map(u =>
    `<span class="user-badge${u.id === 0 ? " ai" : u.id === myId ? " self" : ""}${u.isController ? " controller" : ""}${u.isController && released ? " released" : ""}">${u.id === 0 ? "AI" : u.isController ? "user" : u.id === myId ? "ia" : u.name}</span>`
  ).join("");
}

export function showOverlay(msg, btn = false) {
  $("overlayMsg").textContent = msg; $("overlayBtn").style.display = btn ? "block" : "none"; $("overlay").classList.add("active");
}

export const hideOverlay = () => $("overlay").classList.remove("active");
