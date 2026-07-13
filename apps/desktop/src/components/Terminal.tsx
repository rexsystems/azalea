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

function syncTerminalFit(term: XTerm, fitAddon: FitAddon) {
  fitAddon.fit();

  const core = (term as XTerm & {
    _core?: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } };
  })._core;
  const cell = core?._renderService.dimensions.css.cell;
  if (!term.element || !cell || cell.width <= 0 || cell.height <= 0) return;

  term.element.style.width = `${term.cols * cell.width}px`;
  term.element.style.height = `${term.rows * cell.height}px`;
}

export function TerminalView({
  sessionId,
  active,
  settings,
  onResize,
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
  const onResizeRef = useRef(onResize);
  const onStatusChangeRef = useRef(onStatusChange);
  const activeRef = useRef(active);
  const sizedRef = useRef(false);

  settingsRef.current = settings;
  onResizeRef.current = onResize;
  onStatusChangeRef.current = onStatusChange;
  activeRef.current = active;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const term = new XTerm({
      cursorBlink: true,
      scrollback: 8000,
      fontFamily: "JetBrains Mono, Fira Code, monospace",
      fontSize: settingsRef.current.fontSize,
      theme: {
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
      },
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
    syncTerminalFit(term, fitAddon);
    requestAnimationFrame(() => syncTerminalFit(term, fitAddon));

    termRef.current = term;
    fitRef.current = fitAddon;

    if (!sizedRef.current) {
      sizedRef.current = true;
      onResizeRef.current(sessionId, term.cols, term.rows);
    }

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
      void api.resizeTerminal(sessionId, cols, rows);
    });
    resizeObserver.observe(container);

    const dataDisposable = term.onData((data) => {
      void api.writeTerminal(sessionId, encodeBytes(new TextEncoder().encode(data)));
    });

    let unlistenOutput: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    void listen<{ session_id: string; data: string }>("terminal-output", (event) => {
      if (event.payload.session_id !== sessionId) return;
      term.write(decodeBase64(event.payload.data));
    }).then((fn) => {
      unlistenOutput = fn;
    });

    void listen<{ session_id: string; status: string; error?: string }>(
      "terminal-status",
      (event) => {
        if (event.payload.session_id !== sessionId) return;
        onStatusChangeRef.current?.(event.payload.status, event.payload.error);
        if (event.payload.status === "disconnected" || event.payload.status === "error") {
          const label =
            event.payload.status === "error"
              ? event.payload.error ?? "Connection failed"
              : "Connection lost — reconnecting...";
          term.write(`\r\n\x1b[38;5;141m[Azalea]\x1b[0m ${label}\r\n`);
        }
      },
    ).then((fn) => {
      unlistenStatus = fn;
    });

    return () => {
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
        void api.resizeTerminal(sessionId, term.cols, term.rows);
      }
    }
  }, [settings.fontSize, sessionId, active]);

  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      syncTerminalFit(termRef.current, fitRef.current);
      const { cols, rows } = termRef.current;
      void api.resizeTerminal(sessionId, cols, rows);
      termRef.current.focus();
    }
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
