import { createTerminal, fitTerminal, getTerminal } from "./terminal.js";
import { connect, disconnect } from "./connection.js";
import { showToast, updateUI, renderUsers, showOverlay, hideOverlay } from "./ui.js";
import { takeControl, sendInput, sendResize } from "./control.js";
import { initArchive } from "./archive.js";

let myId = null, controllerId = null;
const ownsControl = () => myId !== null && controllerId === myId;
const resize = () => { if (ownsControl()) { const term = getTerminal(); sendResize(term.cols, term.rows); } };

function handleMsg(msg) {
  if (!msg) return;
  const term = getTerminal();
  if (msg.type === "welcome") {
    // Queue the reset with output so pending writes cannot duplicate the replay.
    term.write("\x1bc");
    myId = msg.clientId; controllerId = msg.controllerId;
    hideOverlay(); renderUsers(msg.clients, myId); updateUI(myId, controllerId);
    fitTerminal(); resize(); term.focus();
  } else if (msg.type === "history" || msg.type === "output") {
    if (typeof msg.data === "string") term.write(msg.data);
  } else if (msg.type === "state") {
    const owned = ownsControl();
    controllerId = msg.controllerId;
    renderUsers(msg.clients, myId); updateUI(myId, controllerId);
    if (!owned && ownsControl()) resize();
  } else if (msg.type === "control_changed") {
    const owned = ownsControl();
    controllerId = msg.controllerId;
    updateUI(myId, controllerId);
    if (!owned && ownsControl()) resize();
    showToast(controllerId === myId ? "Tienes el control" : `Control: ${msg.controllerName}`);
  } else if (msg.type === "error") {
    showToast(msg.message, "error");
  } else if (msg.type === "session_ended") {
    disconnect(); myId = null; controllerId = null;
    updateUI(myId, controllerId);
    showOverlay("La sesión del shell ha terminado.", true);
  }
}

(function init() {
  initArchive();
  const el = document.getElementById("terminal"), term = createTerminal(el);
  term.onData(data => { if (ownsControl()) sendInput(data); });
  term.onResize(resize);
  window.addEventListener("resize", fitTerminal);
  new ResizeObserver(fitTerminal).observe(el);
  document.getElementById("btnControl").onclick = () => {
    if (myId === null) return;
    if (ownsControl()) showToast("Control cedido");
    takeControl(myId, controllerId);
  };
  connect(() => {}, handleMsg, delay => {
    myId = null; controllerId = null; updateUI(myId, controllerId);
    showOverlay(`Conexión perdida. Reconectando en ${delay / 1000} s…`, true);
  });
})();
