import { getTerminal } from "./terminal.js";
const $ = (id) => document.getElementById(id);
let toastTimer = null;

export function showToast(text, type = "info", dur = 3000) {
  const el = $("toast"); el.textContent = text; el.className = `toast ${type} show`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

export function updateUI(myId, cid, readonly = false) {
  const isMe = cid === myId, isAI = cid === 0, t = getTerminal(), s = $("status");
  const p = new URLSearchParams(location.search), agentName = p.get("agent"), agentRole = p.get("role");
  s.textContent = readonly ? "Viewer" : isAI ? "AI" : isMe ? (agentName && agentRole ? `${agentName} — ${agentRole}` : agentName || "Humano") : "IA";
  s.className = "bar-status " + (readonly ? "readonly" : (isMe || isAI ? "on" : "off"));
  t.element.style.opacity = readonly ? "0.9" : (isMe || isAI) ? "1" : "0.85";
  $("btnControl").textContent = readonly ? "View" : isMe ? "Soltar" : "Control";
  $("btnControl").className = "bar-btn" + (readonly ? " readonly" : isMe ? " active" : "");
  if (readonly) $("btnControl").disabled = true;
}

export function renderUsers(list, myId, released = false) {
  $("users").innerHTML = list.map(u =>
    `<span class="user-badge${u.id === 0 ? " ai" : u.id === myId ? " self" : ""}${u.isController ? " controller" : ""}${u.isController && released ? " released" : ""}">${u.id === 0 ? "AI" : u.id === myId ? "user" : u.name}</span>`
  ).join("");
}

export function showOverlay(msg, btn = false) {
  $("overlayMsg").textContent = msg; $("overlayBtn").style.display = btn ? "block" : "none"; $("overlay").classList.add("active");
}

export const hideOverlay = () => $("overlay").classList.remove("active");
