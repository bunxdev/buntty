import { send } from "./connection.js";
import { showToast } from "./ui.js";

const MAX_SIZE = 10 * 1024 * 1024;

export function initFileTransfer() {
  const terminal = document.getElementById("terminal"), drop = document.getElementById("dropZone");
  let dragCount = 0;

  terminal.addEventListener("dragenter", (e) => { e.preventDefault(); dragCount++; drop.hidden = false; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  drop.addEventListener("dragleave", () => { if (--dragCount <= 0) { dragCount = 0; drop.hidden = true; } });

  drop.addEventListener("drop", (e) => {
    e.preventDefault(); dragCount = 0; drop.hidden = true;
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    files.forEach((f) => {
      if (f.size > MAX_SIZE) return showToast(`${f.name}: exceeds 10MB limit`, "error");
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const b64 = btoa(binary);
        send({ type: "upload", name: f.name, data: b64, size: f.size });
        showToast(`Uploading ${f.name}...`, "info");
      };
      reader.onerror = () => showToast(`Failed to read ${f.name}`, "error");
      reader.readAsArrayBuffer(f);
    });
  });
}

export function handleUploadComplete(msg) {
  showToast(`Uploaded: ${msg.name} → ${msg.path}`, "info");
}
