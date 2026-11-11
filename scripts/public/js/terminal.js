import { THEMES, getSavedTheme, applyTheme } from "./themes.js";

let term = null, fitAddon = null, searchAddon = null;

export function createTerminal(el) {
  const themeId = getSavedTheme(), theme = THEMES[themeId] || THEMES.buntty;
  term = new Terminal({ cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches, cursorStyle: "bar", fontSize: 14,
    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace", theme });
  fitAddon = new FitAddon.FitAddon(); term.loadAddon(fitAddon);
  try { const webgl = new WebglAddon.WebglAddon(); webgl.onContextLoss(() => webgl.dispose()); term.loadAddon(webgl); } catch {}
  searchAddon = new SearchAddon.SearchAddon(); term.loadAddon(searchAddon);
  try { const imgAddon = new ImageAddon.ImageAddon(); term.loadAddon(imgAddon); } catch {}
  term.open(el); fitAddon.fit();
  document.body.style.background = theme.background;
  return term;
}

export const getTerminal = () => term;
export const fitTerminal = () => fitAddon && fitAddon.fit();
export const getSearchAddon = () => searchAddon;
