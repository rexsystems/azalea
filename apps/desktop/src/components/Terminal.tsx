import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
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
  const settingsRef = useRef(settings);
  const onResizeRef = useRef(onResize);
  const onStatusChangeRef = useRef(onStatusChange);
  const sizedRef = useRef(false);

  settingsRef.current = settings;
  onResizeRef.current = onResize;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const term = new XTerm({
      cursorBlink: true,
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
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1 || !settingsRef.current.middleClickToPaste) return;
      e.preventDefault();
      void pasteFromClipboard(term);
    };

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("mousedown", onMouseDown);

    const resizeObserver = new ResizeObserver(() => {
      if (!active) return;
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
          term.write(`\r\n\x1b[38;5;141m[Azalea]\x1b[0m ${event.payload.error ?? "Session ended"}\r\n`);
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
      container.removeEventListener("mousedown", onMouseDown);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
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

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${active ? "flex items-start" : "hidden"}`}
      style={{ background: "var(--terminal-bg)" }}
    />
  );
}
