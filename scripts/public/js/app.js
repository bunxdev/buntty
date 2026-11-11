import { createTerminal, fitTerminal, getTerminal, getSearchAddon } from "./terminal.js";
import { connect, sessionId, withToken } from "./connection.js";
import { showToast, updateUI, renderUsers, showOverlay, hideOverlay } from "./ui.js";
import { takeControl, sendInput, sendResize } from "./control.js";
import { THEMES, getSavedTheme, saveTheme, applyTheme } from "./themes.js";
import { initFileTransfer, handleUploadComplete } from "./file-transfer.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isMinimal = params.get("minimal") === "1";

let myId = null, controllerId = null, justReleased = false, isReadonly = params.get("readonly") === "1";
let clients = [], sessionOver = false;
const mods = { ctrl: false, alt: false }; // sticky modifiers from the touch key strip

const refreshUI = () => updateUI(myId, controllerId, isReadonly, clients);

function handleMsg(msg, raw) {
  if (raw) return getTerminal().write(raw);
  if ((msg.type === "history" || msg.type === "output") && msg.data) getTerminal().write(msg.data);
  if (msg.type === "welcome") {
    myId = msg.clientId; controllerId = msg.controllerId; isReadonly = !!msg.readonly; clients = msg.clients || [];
    hideOverlay(); renderUsers(clients, myId); refreshUI(); fitTerminal();
    $("readonlyBadge").hidden = !isReadonly;
  }
  if (msg.type === "state") {
    controllerId = msg.controllerId; clients = msg.clients || [];
    renderUsers(clients, myId, justReleased); justReleased = false; refreshUI();
  }
  if (msg.type === "control_changed") {
    const prev = controllerId; controllerId = msg.controllerId;
    if (msg.controllerId === 0) showToast("La IA tomó el control", "warn");
    else if (msg.controllerId === myId && prev !== myId) showToast("Tienes el control", "success");
    else if (prev === myId && !justReleased) showToast(`${msg.controllerName || "Otro usuario"} tomó el control`, "warn");
  }
  if (msg.type === "error") showOverlay(msg.message, true);
  if (msg.type === "session_ended") { sessionOver = true; showOverlay("La sesión del shell ha terminado.", true); }
  if (msg.type === "exit") showToast("El shell ha finalizado", "error");
  if (msg.type === "upload_complete") handleUploadComplete(msg);
  if (msg.type === "upload_error") showToast(`Error al subir: ${msg.error}`, "error");
}

const popups = [];

function registerPopup(panel, btn, onOpen) {
  const entry = { panel, btn, close: () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); } };
  popups.push(entry);
  btn.addEventListener("click", () => {
    const opening = panel.hidden;
    closePopups();
    if (!opening) return;
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect(), w = panel.offsetWidth;
    panel.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
    onOpen?.();
  });
  return entry;
}

function closePopups() { popups.forEach((p) => p.close()); }

document.addEventListener("click", (e) => {
  for (const p of popups) if (!p.panel.hidden && !p.panel.contains(e.target) && !p.btn.contains(e.target)) p.close();
});

function initSearch() {
  const bar = $("searchBar"), input = $("searchInput"), btn = $("btnSearch"), sa = getSearchAddon();
  const open = () => { bar.hidden = false; btn.setAttribute("aria-expanded", "true"); input.focus(); input.select(); };
  const close = () => { bar.hidden = true; btn.setAttribute("aria-expanded", "false"); sa.clearDecorations?.(); getTerminal().focus(); };
  const run = (back, incremental = false) => {
    if (!input.value) return input.classList.remove("no-match");
    const found = back ? sa.findPrevious(input.value) : sa.findNext(input.value, { incremental });
    input.classList.toggle("no-match", !found);
    input.setAttribute("aria-invalid", String(!found));
  };
  btn.onclick = () => (bar.hidden ? open() : close());
  $("searchClose").onclick = close;
  $("searchNext").onclick = () => run(false);
  $("searchPrev").onclick = () => run(true);
  input.addEventListener("input", () => run(false, true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); run(e.shiftKey); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyF") {
      e.preventDefault(); e.stopPropagation(); bar.hidden ? open() : close();
    }
  }, true);
  return close;
}

(function init() {
  const el = $("terminal"), term = createTerminal(el);
  if (isMinimal) {
    document.querySelectorAll("#recIndicator, #btnRec, #btnReplay, #btnTheme, #btnSearch, #btnFiles").forEach((n) => { n.hidden = true; });
  }
  showIdentity();
  term.onData((d) => {
    if (isReadonly || controllerId !== myId) return;
    // Sticky Ctrl/Alt from the touch strip also apply to the soft keyboard
    if ((mods.ctrl || mods.alt) && d.length === 1) { d = keySequence(d, mods); resetMods(); }
    sendInput(d);
  });
  term.onResize(({ cols, rows }) => sendResize(cols, rows));
  window.addEventListener("resize", fitTerminal); new ResizeObserver(fitTerminal).observe(el);
  $("btnControl").onclick = () => {
    if (isReadonly) return showToast("Modo solo lectura", "warn");
    if (controllerId === myId) { justReleased = true; showToast("Soltaste el control", "info"); }
    takeControl(myId, controllerId);
  };
  $("overlayBtn").onclick = () => location.reload();
  const closeSearch = initSearch();
  initThemePicker();
  initMobileKeys();
  initFileTransfer(() => !isReadonly && !isMinimal);
  initFilesPanel();
  initRecording();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = popups.find((p) => !p.panel.hidden);
    if (open) {
      // Return focus to the trigger when it was inside the popup (WAI-ARIA disclosure)
      const back = open.panel.contains(document.activeElement) || open.btn === document.activeElement;
      closePopups(); (back ? open.btn : getTerminal()).focus();
    }
    else if (!$("searchBar").hidden && document.activeElement !== $("searchInput")) closeSearch();
  });
  connect(() => { fitTerminal(); term.focus(); }, handleMsg, () => {
    if (!sessionOver) showOverlay("Se perdió la conexión con el servidor.", true);
    $("status").textContent = "Desconectado"; $("status").className = "bar-status off";
  });
})();

/** Label the pane with the agent name/color (grid panes) and the tab with the session. */
function showIdentity() {
  const agent = params.get("agent"), color = params.get("color"), brand = document.querySelector(".bar-brand");
  if (agent) {
    brand.textContent = agent;
    brand.title = params.get("role") || agent;
    if (/^#[0-9a-f]{3,8}$/i.test(color || "")) brand.style.color = color;
  }
  document.title = `${agent || "BunTTY"} · ${sessionId()}`;
}

function initThemePicker() {
  const list = $("themeList");
  let current = getSavedTheme();
  function render() {
    list.replaceChildren(...Object.entries(THEMES).map(([id, t]) => {
      const b = document.createElement("button"), sw = document.createElement("span");
      b.type = "button"; b.className = "theme-opt";
      b.setAttribute("aria-pressed", String(id === current));
      sw.className = "theme-swatch"; sw.style.background = t.background;
      b.append(sw, t.name);
      b.onclick = () => { current = id; saveTheme(id); applyTheme(getTerminal(), id); render(); list.querySelector('[aria-pressed="true"]')?.focus(); };
      return b;
    }));
  }
  render();
  registerPopup($("themePicker"), $("btnTheme"), () => list.querySelector('[aria-pressed="true"]')?.focus());
}

function initFilesPanel() {
  const list = $("filesList");
  const msg = (text, cls = "") => { const d = document.createElement("div"); d.className = "files-msg " + cls; d.textContent = text; list.replaceChildren(d); };
  const entry = registerPopup($("filesPanel"), $("btnFiles"), async () => {
    msg("Cargando...");
    try {
      const res = await fetch(withToken(`/api/uploads?session=${encodeURIComponent(sessionId())}`));
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (!data.files?.length) return msg("Aún no hay archivos. Arrastra archivos sobre el terminal para subirlos.");
      list.replaceChildren(...data.files.map((f) => {
        const a = document.createElement("a");
        a.className = "file-item"; a.href = withToken(f.url); a.download = f.name; a.textContent = f.name; a.title = f.name;
        return a;
      }));
    } catch { msg("No se pudieron cargar los archivos", "error"); }
  });
  $("filesClose").onclick = () => { entry.close(); $("btnFiles").focus(); };
}

function initRecording() {
  const session = encodeURIComponent(sessionId());
  $("btnRec").onclick = () => {
    const a = document.createElement("a");
    a.href = withToken(`/api/recording?session=${session}`); a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
  };
  $("btnReplay").onclick = () => window.open(withToken(`/replay?session=${session}`), "_blank", "noopener");
}

const ARROWS = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" };
const CTRL_PUNCT = { "@": 0, " ": 0, "[": 27, "\\": 28, "]": 29, "^": 30, "_": 31, "-": 31, "/": 31, "?": 127 };

function keySequence(key, mods) {
  if (ARROWS[key]) {
    const m = 1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
    return m === 1 ? `\x1b[${ARROWS[key]}` : `\x1b[1;${m}${ARROWS[key]}`;
  }
  let seq = key === "Escape" ? "\x1b" : key === "Tab" ? "\t" : key;
  if (mods.ctrl && seq.length === 1) {
    const c = seq.toUpperCase();
    if (c >= "A" && c <= "Z") seq = String.fromCharCode(c.charCodeAt(0) - 64);
    else if (c in CTRL_PUNCT) seq = String.fromCharCode(CTRL_PUNCT[c]);
  }
  return mods.alt ? "\x1b" + seq : seq;
}

function resetMods() {
  mods.ctrl = mods.alt = false;
  document.querySelectorAll("#mobileKeys .mod-btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
}

function initMobileKeys() {
  const strip = $("mobileKeys");
  if (!("ontouchstart" in window || navigator.maxTouchPoints > 0)) return;
  strip.hidden = false;
  document.body.classList.add("has-mobile-keys");
  fitTerminal();
  strip.addEventListener("mousedown", (e) => e.preventDefault());
  strip.addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const mod = btn.dataset.mod;
    if (mod) { mods[mod] = !mods[mod]; btn.setAttribute("aria-pressed", String(mods[mod])); return; }
    const key = btn.dataset.key; if (!key) return;
    if (isReadonly) showToast("Modo solo lectura", "warn");
    else if (controllerId !== myId) showToast("Toma el control para escribir", "warn");
    else sendInput(keySequence(key, mods));
    resetMods();
    getTerminal().focus();
  });
}
