import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XTerm } from "@xterm/xterm";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSettings } from "../lib/settings";
import * as api from "../lib/api";

interface TerminalProps {
  sessionId: string;
  active: boolean;
  settings: TerminalSettings;
  bootstrapLocal?: boolean;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onStatusChange?: (status: string, error?: string) => void;
}

function encodeBytes(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function pasteFromClipboard(term: XTerm) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) term.paste(text);
  } catch {
    // clipboard unavailable
  }
}

function terminalBgColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--terminal-bg")
    .trim() || "#14171d";
}

function xtermPalette() {
  const theme = document.documentElement.dataset.theme ?? "midnight";
  if (theme === "noir") {
    return {
      background: terminalBgColor(),
      foreground: "#f5f5f5",
      cursor: "#ffffff",
      selectionBackground: "#ffffff33",
      black: "#0a0a0a",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#93c5fd",
      magenta: "#d8b4fe",
      cyan: "#67e8f9",
      white: "#f5f5f5",
      brightBlack: "#737373",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#bfdbfe",
      brightMagenta: "#e9d5ff",
      brightCyan: "#a5f3fc",
      brightWhite: "#ffffff",
    };
  }

  return {
    background: terminalBgColor(),
    foreground: "#eceef1",
    cursor: "#5b9bf5",
    selectionBackground: "#5b9bf540",
    black: "#1e222a",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#eceef1",
    brightBlack: "#6b7280",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  };
}

function syncTerminalFit(term: XTerm, fitAddon: FitAddon) {
  if (!term.element) return;

  const container = term.element.parentElement;
  if (container) {
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
  }

  try {
    fitAddon.fit();
  } catch {
    // xterm is not fully initialized yet (hidden container, etc.)
  }
}

async function waitForTerminalLayout(term: XTerm, fitAddon: FitAddon, container: HTMLElement) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      syncTerminalFit(term, fitAddon);
      if (term.cols > 0 && term.rows > 0) return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  syncTerminalFit(term, fitAddon);
}

async function attachBackend(
  term: XTerm,
  fitAddon: FitAddon,
  sessionId: string,
  container: HTMLElement,
) {
  await waitForTerminalLayout(term, fitAddon, container);

  const { cols, rows } = term;
  if (cols <= 0 || rows <= 0) return;

  try {
    await api.resizeTerminal(sessionId, cols, rows);
  } catch {
    // Session may have exited before the UI attached.
  }
}

export function TerminalView({
  sessionId,
  active,
  settings,
  bootstrapLocal = false,
  onStatusChange,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const settingsRef = useRef(settings);
  const onStatusChangeRef = useRef(onStatusChange);
  const activeRef = useRef(active);
  const bootstrapLocalRef = useRef(bootstrapLocal);
  const sizedRef = useRef(false);
  const bootstrappedRef = useRef(false);

  settingsRef.current = settings;
  onStatusChangeRef.current = onStatusChange;
  activeRef.current = active;
  bootstrapLocalRef.current = bootstrapLocal;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const term = new XTerm({
      cursorBlink: true,
      scrollback: 8000,
      fontFamily: "JetBrains Mono, Fira Code, monospace",
      fontSize: settingsRef.current.fontSize,
      theme: xtermPalette(),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchRef.current = searchAddon;
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.shiftKey && key === "f") {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return false;
      }
      // App-level shortcuts: let them bubble instead of going to the shell.
      if (event.ctrlKey && key === "tab") return false;
      if (event.ctrlKey && event.shiftKey && (key === "w" || key === "t")) return false;
      return true;
    });
    term.open(container);

    termRef.current = term;
    fitRef.current = fitAddon;

    const copySelection = () => {
      if (!settingsRef.current.selectToCopy || !term.hasSelection()) return;
      const text = term.getSelection();
      if (text) void navigator.clipboard.writeText(text);
    };

    const onMouseUp = () => copySelection();
    const onContextMenu = (e: MouseEvent) => {
      if (!settingsRef.current.rightClickToPaste) return;
      e.preventDefault();
      void pasteFromClipboard(term);
    };

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("contextmenu", onContextMenu);

    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) return;
      syncTerminalFit(term, fitAddon);
      const { cols, rows } = term;
      if (cols <= 0 || rows <= 0) return;
      void api.resizeTerminal(sessionId, cols, rows).catch(() => undefined);
    });
    resizeObserver.observe(container);

    const dataDisposable = term.onData((data) => {
      void api
        .writeTerminal(sessionId, encodeBytes(new TextEncoder().encode(data)))
        .catch(() => undefined);
    });

    let unlistenOutput: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      unlistenOutput = await listen<{ session_id: string; data: string }>(
        "terminal-output",
        (event) => {
          if (event.payload.session_id !== sessionId) return;
          term.write(decodeBase64(event.payload.data), () => undefined);
        },
      );

      unlistenStatus = await listen<{ session_id: string; status: string; error?: string }>(
        "terminal-status",
        (event) => {
          if (event.payload.session_id !== sessionId) return;
          onStatusChangeRef.current?.(event.payload.status, event.payload.error);
          if (event.payload.status === "disconnected" || event.payload.status === "error") {
            const label =
              event.payload.status === "error"
                ? event.payload.error ?? "Connection failed"
                : "Connection lost, reconnecting...";
            term.write(`\r\n\x1b[38;5;141m[Azalea]\x1b[0m ${label}\r\n`);
          }
        },
      );

      if (cancelled) return;

      await waitForTerminalLayout(term, fitAddon, container);

      if (bootstrapLocalRef.current && !bootstrappedRef.current) {
        bootstrappedRef.current = true;
        try {
          const cols = term.cols > 0 ? term.cols : 120;
          const rows = term.rows > 0 ? term.rows : 30;
          await api.startLocalTerminal(sessionId, cols, rows);
        } catch (err) {
          onStatusChangeRef.current?.("error", String(err));
          return;
        }
      }

      if (!sizedRef.current) {
        sizedRef.current = true;
        await attachBackend(term, fitAddon, sessionId, container);
      }
    })();

    return () => {
      cancelled = true;
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenStatus?.();
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("contextmenu", onContextMenu);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      sizedRef.current = false;
      bootstrappedRef.current = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term || !fitAddon) return;

    if (term.options.fontSize !== settings.fontSize) {
      term.options.fontSize = settings.fontSize;
      syncTerminalFit(term, fitAddon);
      if (active) {
        void api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => undefined);
      }
    }
  }, [settings.fontSize, sessionId, active]);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    const container = containerRef.current;
    if (!term || !fitAddon || !container || !active) return;

    void attachBackend(term, fitAddon, sessionId, container).then(() => {
      term.focus();
    });
  }, [active, sessionId]);

  const runSearch = (query: string, direction: "next" | "previous") => {
    const search = searchRef.current;
    if (!search || !query) return;
    const options = {
      decorations: {
        matchOverviewRuler: "#a855f7",
        activeMatchColorOverviewRuler: "#facc15",
        matchBackground: "#a855f755",
        activeMatchBackground: "#facc1580",
      },
    };
    if (direction === "next") search.findNext(query, options);
    else search.findPrevious(query, options);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div className={`relative h-full w-full ${active ? "" : "hidden"}`}>
      {searchOpen && (
        <div
          className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-lg border px-2 py-1.5 shadow-lg"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              runSearch(e.target.value, "next");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(searchQuery, e.shiftKey ? "previous" : "next");
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Search..."
            className="w-44 bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
          />
          <button
            onClick={() => runSearch(searchQuery, "previous")}
            className="hover-subtle rounded p-1"
            style={{ color: "var(--text-muted)" }}
            title="Previous (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => runSearch(searchQuery, "next")}
            className="hover-subtle rounded p-1"
            style={{ color: "var(--text-muted)" }}
            title="Next (Enter)"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={closeSearch}
            className="hover-subtle rounded p-1"
            style={{ color: "var(--text-muted)" }}
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex h-full w-full items-start overflow-hidden"
        style={{ background: "var(--terminal-bg)" }}
      />
    </div>
  );
}
