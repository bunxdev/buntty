let term = null, fitAddon = null;

export function createTerminal(el) {
  term = new Terminal({ cursorBlink: true, cursorStyle: "bar", fontSize: 14,
    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
    theme: { background: "#0a0a0a", foreground: "#e0e0e0", cursor: "#e74c3c", cursorAccent: "#0a0a0a", selectionBackground: "#264f78",
      black: "#1a1a2e", red: "#e74c3c", green: "#2ecc71", yellow: "#f39c12", blue: "#3498db", magenta: "#9b59b6", cyan: "#1abc9c", white: "#ecf0f1",
      brightBlack: "#7f8c8d", brightRed: "#ff6b6b", brightGreen: "#2ecc71", brightYellow: "#f1c40f", brightBlue: "#5dade2", brightMagenta: "#af7ac5", brightCyan: "#48c9b0", brightWhite: "#ffffff" } });
  fitAddon = new FitAddon.FitAddon(); term.loadAddon(fitAddon); term.open(el); fitAddon.fit(); return term;
}

export const getTerminal = () => term;
export const fitTerminal = () => fitAddon && fitAddon.fit();
