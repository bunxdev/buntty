import { createTerminal, fitTerminal, getTerminal, getSearchAddon } from "./terminal.js";
import { connect, send } from "./connection.js";
import { showToast, updateUI, renderUsers, showOverlay, hideOverlay } from "./ui.js";
import { takeControl, sendInput, sendResize } from "./control.js";
import { THEMES, getSavedTheme, saveTheme, applyTheme } from "./themes.js";
import { initFileTransfer, handleUploadComplete } from "./file-transfer.js";

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
  msg.type === "upload_complete" && handleUploadComplete(msg);
  msg.type === "upload_error" && showToast(`Upload failed: ${msg.error}`, "error");
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
  initThemePicker();
  initMobileKeys();
  initFileTransfer();
  initFilesPanel();
  connect(() => { fitTerminal(); term.focus(); }, handleMsg, () => showOverlay("Conexion perdida.", true));
})();

function initThemePicker() {
  const picker = document.getElementById("themePicker"), list = document.getElementById("themeList"), btn = document.getElementById("btnTheme");
  let current = getSavedTheme();
  function render() {
    list.innerHTML = "";
    for (const [id, t] of Object.entries(THEMES)) {
      const b = document.createElement("button");
      b.className = "theme-opt" + (id === current ? " active" : "");
      b.innerHTML = `<span class="theme-swatch" style="background:${t.background}"></span>${t.name}`;
      b.onclick = () => { current = id; saveTheme(id); applyTheme(getTerminal(), id); render(); };
      list.appendChild(b);
    }
  }
  render();
  btn.onclick = () => { picker.hidden = !picker.hidden; };
  document.addEventListener("click", (e) => { !picker.contains(e.target) && e.target !== btn && (picker.hidden = true); });
}

function initFilesPanel() {
  const panel = document.getElementById("filesPanel"), list = document.getElementById("filesList"), btn = document.getElementById("btnFiles");
  const session = encodeURIComponent(location.pathname.replace(/\/+$/, "") || "/");
  btn.onclick = async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      list.innerHTML = "<div style='color:#888;font-size:11px;padding:6px'>Loading...</div>";
      try {
        const res = await fetch(`/api/uploads?session=${session}`);
        const data = await res.json();
        if (!data.files.length) { list.innerHTML = "<div style='color:#888;font-size:11px;padding:6px'>No files uploaded yet. Drag & drop files onto the terminal.</div>"; return; }
        list.innerHTML = data.files.map(f => `<a class="file-item" href="${f.url}" download="${f.name}">${f.name}</a>`).join("");
      } catch { list.innerHTML = "<div style='color:#e74c3c;font-size:11px;padding:6px'>Failed to load files</div>"; }
    }
  };
  document.getElementById("filesClose").onclick = () => { panel.hidden = true; };
  document.addEventListener("click", (e) => { !panel.contains(e.target) && e.target !== btn && (panel.hidden = true); });
}

function initMobileKeys() {
  const strip = document.getElementById("mobileKeys");
  if (!("ontouchstart" in window || navigator.maxTouchPoints > 0)) return;
  strip.hidden = false;
  const mods = { ctrl: false, alt: false, shift: false };
  strip.addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const mod = btn.dataset.mod;
    if (mod) { mods[mod] = !mods[mod]; btn.classList.toggle("active", mods[mod]); return; }
    const key = btn.dataset.key; if (!key) return;
    let seq = "";
    if (key === "Escape") seq = "\x1b";
    else if (key === "Tab") seq = "\t";
    else if (key === "ArrowUp") seq = "\x1b[A";
    else if (key === "ArrowDown") seq = "\x1b[B";
    else if (key === "ArrowRight") seq = "\x1b[C";
    else if (key === "ArrowLeft") seq = "\x1b[D";
    else if (mods.ctrl && key.length === 1) seq = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
    else if (mods.alt) seq = "\x1b" + key;
    else seq = key;
    if (!isReadonly && controllerId === myId) sendInput(seq);
    Object.keys(mods).forEach((m) => { mods[m] = false; });
    strip.querySelectorAll(".mod-btn").forEach((b) => b.classList.remove("active"));
    getTerminal().focus();
  });
}
