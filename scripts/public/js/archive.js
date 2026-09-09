const session = location.pathname.replace(/\/+$/, '') || '/';
const panel = document.getElementById('archive');
const files = document.getElementById('archiveFiles');
const content = document.getElementById('archiveContent');
const status = document.getElementById('archiveStatus');
const next = document.getElementById('archiveNext');
const previous = document.getElementById('archivePrevious');
const older = document.getElementById('archiveOlder');
let cursor = null, offsets = [0], page = 0, nextOffset = 0, version = 0;
const url = params => '/api/logs?' + new URLSearchParams({ session, ...params });
async function request(params) {
  const response = await fetch(url(params));
  if (!response.ok) throw new Error('No se pudo leer el historial.');
  return response.json();
}
async function loadPage() {
  const current = ++version;
  next.disabled = true; previous.disabled = true;
  status.textContent = 'Cargando…';
  try {
    const result = await request({ file: files.value, offset: offsets[page] });
    if (current !== version) return;
    content.textContent = result.records.map(record => {
      if (record.type === 'command') return `\n$ ${record.command}\n`;
      if (record.type === 'output') return record.text;
      if (record.type === 'end') return `\n[Salida: ${record.code}]\n`;
      if (record.type === 'block' && record.continuation) return '[Continuación del comando anterior]\n';
      return '';
    }).join('');
    content.scrollTop = 0; nextOffset = result.offset;
    next.disabled = !result.more || nextOffset <= offsets[page]; previous.disabled = page === 0;
    status.textContent = `Página ${page + 1}`;
  } catch (error) { if (current === version) status.textContent = error.message; }
}
async function loadFiles(before) {
  const current = ++version;
  status.textContent = 'Cargando…'; older.disabled = true;
  try {
    const result = await request(before ? { before } : {});
    if (current !== version) return;
    files.replaceChildren(...result.files.map(file => {
      const option = document.createElement('option'); option.value = file;
      const time = new Date(Number(file.slice(0, 13))).toLocaleString();
      option.textContent = `${time} · bloque ${Number(file.slice(-12, -6))}`;
      return option;
    }));
    cursor = result.next; older.disabled = !cursor;
    offsets = [0]; page = 0;
    if (result.files.length) await loadPage();
    else { content.textContent = ''; status.textContent = 'Todavía no hay historial guardado.'; next.disabled = true; previous.disabled = true; }
  } catch (error) { if (current === version) status.textContent = error.message; }
}
export function initArchive() {
  document.getElementById('btnArchive').onclick = () => { panel.showModal(); loadFiles(); };
  document.getElementById('archiveClose').onclick = () => { ++version; panel.close(); };
  document.getElementById('archiveRefresh').onclick = () => loadFiles();
  files.onchange = () => { offsets = [0]; page = 0; loadPage(); };
  next.onclick = () => { offsets[++page] = nextOffset; loadPage(); };
  previous.onclick = () => { if (page > 0) { page--; loadPage(); } };
  older.onclick = () => loadFiles(cursor);
}
