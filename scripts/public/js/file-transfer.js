import { send } from "./connection.js";
import { showToast } from "./ui.js";

const MAX_SIZE = 10 * 1024 * 1024;

/** canUpload() is checked at drop time (readonly / minimal views can't upload). */
export function initFileTransfer(canUpload = () => true) {
  const terminal = document.getElementById("terminal"), drop = document.getElementById("dropZone");
  let dragCount = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  // A file dropped anywhere outside the drop zone must not navigate the page away.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  terminal.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || !canUpload()) return;
    e.preventDefault(); dragCount++; drop.hidden = false;
  });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  drop.addEventListener("dragleave", () => { if (--dragCount <= 0) { dragCount = 0; drop.hidden = true; } });

  drop.addEventListener("drop", (e) => {
    e.preventDefault(); dragCount = 0; drop.hidden = true;
    if (!canUpload()) return showToast("No puedes subir archivos en este modo", "warn");
    const files = [...e.dataTransfer.files];
    files.forEach((f) => {
      if (f.size > MAX_SIZE) return showToast(`${f.name}: supera el límite de 10MB`, "error");
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        send({ type: "upload", name: f.name, data: btoa(binary), size: f.size });
        showToast(`Subiendo ${f.name}...`, "info");
      };
      reader.onerror = () => showToast(`No se pudo leer ${f.name}`, "error");
      reader.readAsArrayBuffer(f);
    });
  });
}

export function handleUploadComplete(msg) {
  showToast(`Subido: ${msg.name} → ${msg.path}`, "success", 5000);
}
