import { createTerminal, fitTerminal, getTerminal } from "./terminal.js";
import { connect, send } from "./connection.js";
import { showToast, updateUI, renderUsers, showOverlay, hideOverlay } from "./ui.js";
import { takeControl, sendInput, sendResize } from "./control.js";

let myId = null, controllerId = null, justReleased = false;

function handleMsg(msg, raw) {
  if (raw) return getTerminal().write(raw);
  (msg.type === "history" || msg.type === "output") && msg.data && getTerminal().write(msg.data);
  msg.type === "welcome" && (myId = msg.clientId, controllerId = msg.controllerId, hideOverlay(), renderUsers(msg.clients, myId), updateUI(myId, controllerId));
  msg.type === "state" && (controllerId = msg.controllerId, renderUsers(msg.clients, myId, justReleased), justReleased = false, updateUI(myId, controllerId));
  msg.type === "control_changed" && (controllerId = msg.controllerId, msg.controllerId === 0 ? showToast("Sediste el control a la IA", "error") : null);
  msg.type === "error" && showOverlay(msg.message, true);
  msg.type === "session_ended" && (showToast("Sesion terminada", "error"), showOverlay("La sesion del shell ha terminado.", true));
  msg.type === "exit" && showToast("Shell finalizado", "error");
}

(function init() {
  const el = document.getElementById("terminal"), term = createTerminal(el);
  term.onData((d) => { controllerId === myId && sendInput(d); });
  term.onResize(({ cols, rows }) => sendResize(cols, rows));
  window.addEventListener("resize", fitTerminal); new ResizeObserver(fitTerminal).observe(el);
  document.getElementById("btnControl").onclick = () => { controllerId === myId && (justReleased = true, showToast("Sediste el control a la IA", "error")); takeControl(myId, controllerId); };
  connect(() => { fitTerminal(); term.focus(); }, handleMsg, () => showOverlay("Conexion perdida.", true));
})();
