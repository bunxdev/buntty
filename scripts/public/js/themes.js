export const THEMES = {
  buntty: { name: "BunTTY", background: "#0a0a0a", foreground: "#e0e0e0", cursor: "#e74c3c", cursorAccent: "#0a0a0a", selectionBackground: "#264f78",
    black: "#1a1a2e", red: "#e74c3c", green: "#2ecc71", yellow: "#f39c12", blue: "#3498db", magenta: "#9b59b6", cyan: "#1abc9c", white: "#ecf0f1",
    brightBlack: "#7f8c8d", brightRed: "#ff6b6b", brightGreen: "#2ecc71", brightYellow: "#f1c40f", brightBlue: "#5dade2", brightMagenta: "#af7ac5", brightCyan: "#48c9b0", brightWhite: "#ffffff" },
  catppuccin: { name: "Catppuccin", background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", cursorAccent: "#1e1e2e", selectionBackground: "#45475a",
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#cba6f7", cyan: "#94e2d5", white: "#bac2de",
    brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#cba6f7", brightCyan: "#94e2d5", brightWhite: "#a6adc8" },
  nord: { name: "Nord", background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440", selectionBackground: "#434c5e",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4" },
  dracula: { name: "Dracula", background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36", selectionBackground: "#44475a",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff" },
  solarized: { name: "Solarized", background: "#002b36", foreground: "#839496", cursor: "#839496", cursorAccent: "#002b36", selectionBackground: "#073642",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3" },
  monokai: { name: "Monokai", background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", cursorAccent: "#272822", selectionBackground: "#49483e",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75", blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75", brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5" },
  light: { name: "Light", background: "#fafafa", foreground: "#383a42", cursor: "#526eff", cursorAccent: "#fafafa", selectionBackground: "#d7d7ff",
    black: "#383a42", red: "#e45649", green: "#50a14f", yellow: "#c18401", blue: "#4078f2", magenta: "#a626a4", cyan: "#0184bc", white: "#fafafa",
    brightBlack: "#a0a1a7", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff" },
};

const KEY = "buntty_theme";

export function getSavedTheme() {
  try { return localStorage.getItem(KEY) || "buntty"; } catch { return "buntty"; }
}

export function saveTheme(id) {
  try { localStorage.setItem(KEY, id); } catch {}
}

export function applyTheme(term, id) {
  const t = THEMES[id]; if (!t) return;
  term.options.theme = t;
  document.body.style.background = t.background;
  document.documentElement.style.setProperty("--term-bg", t.background);
}
