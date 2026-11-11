import { createTerminal, fitTerminal, getTerminal, getSearchAddon } from "./terminal.js";
import { connect, send } from "./connection.js";
import { showToast, updateUI, renderUsers, showOverlay, hideOverlay } from "./ui.js";
import { takeControl, sendInput, sendResize } from "./control.js";

let myId = null, controllerId = null, justReleased = false, isReadonly = false;

function handleMsg(msg, raw) {
  if (raw) return getTerminal().write(raw);
  (msg.type === "history" || msg.type === "output") && msg.data && getTerminal().write(msg.data);
  if (msg.type === "welcome") {
    myId = msg.clientId; controllerId = msg.controllerId; isReadonly = !!msg.readonly;
    hideOverlay(); renderUsers(msg.clients, myId); updateUI(myId, controllerId, isReadonly); fitTerminal();
    if (isReadonly) document.getElementById("readonlyBadge").hidden = false;
  }
  msg.type === "state" && (controllerId = msg.controllerId, renderUsers(msg.clients, myId, justReleased), justReleased = false, updateUI(myId, controllerId, isReadonly));
  msg.type === "control_changed" && (controllerId = msg.controllerId, msg.controllerId === 0 ? showToast("Sediste el control a la IA", "error") : null);
  msg.type === "error" && showOverlay(msg.message, true);
  msg.type === "session_ended" && (showToast("Sesion terminada", "error"), showOverlay("La sesion del shell ha terminado.", true));
  msg.type === "exit" && showToast("Shell finalizado", "error");
}

function initSearch() {
  const bar = document.getElementById("searchBar"), input = document.getElementById("searchInput"), sa = getSearchAddon();
  const toggle = () => { bar.hidden = !bar.hidden; bar.hidden || (input.focus(), input.select()); };
  document.getElementById("btnSearch").onclick = toggle;
  document.getElementById("searchClose").onclick = () => { bar.hidden = true; getTerminal().focus(); };
  document.getElementById("searchNext").onclick = () => sa.findNext(input.value);
  document.getElementById("searchPrev").onclick = () => sa.findPrevious(input.value);
  input.addEventListener("keydown", (e) => {
    e.key === "Enter" && (e.shiftKey ? sa.findPrevious(input.value) : sa.findNext(input.value));
    e.key === "Escape" && (bar.hidden = true, getTerminal().focus());
  });
  document.addEventListener("keydown", (e) => { (e.ctrlKey || e.metaKey) && e.key === "f" && (e.preventDefault(), toggle()); });
}

(function init() {
  const el = document.getElementById("terminal"), term = createTerminal(el);
  const params = new URLSearchParams(location.search);
  isReadonly = params.get("readonly") === "1";
  term.onData((d) => { !isReadonly && controllerId === myId && sendInput(d); });
  term.onResize(({ cols, rows }) => sendResize(cols, rows));
  window.addEventListener("resize", fitTerminal); new ResizeObserver(fitTerminal).observe(el);
  document.getElementById("btnControl").onclick = () => {
    if (isReadonly) return showToast("Read-only mode", "warn");
    controllerId === myId && (justReleased = true, showToast("Sediste el control a la IA", "error")); takeControl(myId, controllerId);
  };
  initSearch();
  connect(() => { fitTerminal(); term.focus(); }, handleMsg, () => showOverlay("Conexion perdida.", true));
})();
