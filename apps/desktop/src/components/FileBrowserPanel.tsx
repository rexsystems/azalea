import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "@azalea/shared";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  File,
  FileCode,
  FileText,
  Folder,
  Home,
  Pencil,
  RefreshCw,
  TerminalSquare,
  Upload,
  X,
} from "./icons";
import * as api from "../lib/api";

interface FileBrowserPanelProps {
  sessionId: string;
  onClose: () => void;
  onCdTerminal: (path: string) => void;
}

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "log",
  "conf",
  "cfg",
  "ini",
  "yml",
  "yaml",
  "json",
  "toml",
  "env",
  "sh",
  "bash",
  "zsh",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "rs",
  "go",
  "c",
  "h",
  "cpp",
  "hpp",
  "java",
  "rb",
  "php",
  "sql",
  "xml",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
  "dockerfile",
  "service",
  "timer",
]);

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["sh", "py", "js", "ts", "rs", "go", "c", "cpp", "java", "rb", "php"].includes(ext)) {
    return FileCode;
  }
  if (TEXT_EXTS.has(ext)) {
    return FileText;
  }
  return File;
}

function isLikelyTextFile(name: string): boolean {
  const base = name.toLowerCase();
  if (base === "dockerfile" || base === "makefile" || base === "cmakelists.txt") return true;
  if (base.startsWith(".") && !base.includes(".", 1)) return true;
  const ext = base.includes(".") ? base.split(".").pop() ?? "" : "";
  return TEXT_EXTS.has(ext);
}

function parentPath(path: string): string {
  if (path === "/" || !path.includes("/")) return "/";
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

function basename(localPath: string): string {
  return localPath.replace(/\\/g, "/").split("/").pop() ?? "upload";
}

export function FileBrowserPanel({ sessionId, onClose, onCdTerminal }: FileBrowserPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editor, setEditor] = useState<{
    remotePath: string;
    name: string;
    contents: string;
    dirty: boolean;
    saving: boolean;
  } | null>(null);

  const pathRef = useRef(path);
  const transferRef = useRef(transfer);
  pathRef.current = path;
  transferRef.current = transfer;

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.sftpList(sessionId, target);
        setPath(result.path);
        setEntries(result.entries);
        if (!target) setHomePath(result.path);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const joinPath = (name: string) => (path === "/" ? `/${name}` : `${path}/${name}`);

  const uploadPaths = useCallback(
    async (localPaths: string[]) => {
      const current = pathRef.current;
      if (!current || transferRef.current || localPaths.length === 0) return;

      setNotice(null);
      let ok = 0;
      for (const local of localPaths) {
        const filename = basename(local);
        setTransfer(`Uploading ${filename}...`);
        try {
          const remote = current === "/" ? `/${filename}` : `${current}/${filename}`;
          await api.sftpUpload(sessionId, local, remote);
          ok += 1;
        } catch (err) {
          setNotice(String(err));
          setTransfer(null);
          await load(current);
          return;
        }
      }
      setTransfer(null);
      setNotice(ok === 1 ? `Uploaded ${basename(localPaths[0])}` : `Uploaded ${ok} files`);
      await load(current);
    },
    [sessionId, load],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const webview = getCurrentWebview();
      const window = getCurrentWindow();
      unlisten = await webview.onDragDropEvent(async (event) => {
        if (cancelled) return;
        const panel = panelRef.current;
        if (!panel) return;

        const payload = event.payload;
        if (payload.type === "leave") {
          setDragOver(false);
          return;
        }

        let scale = 1;
        try {
          scale = await window.scaleFactor();
        } catch {
          scale = 1;
        }

        const overPanel = (x: number, y: number) => {
          const rect = panel.getBoundingClientRect();
          const lx = x / scale;
          const ly = y / scale;
          return lx >= rect.left && lx <= rect.right && ly >= rect.top && ly <= rect.bottom;
        };

        if (payload.type === "enter" || payload.type === "over") {
          setDragOver(overPanel(payload.position.x, payload.position.y));
          return;
        }

        if (payload.type === "drop") {
          const inside = overPanel(payload.position.x, payload.position.y);
          setDragOver(false);
          if (!inside) return;
          void uploadPaths(payload.paths);
        }
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [uploadPaths]);

  const downloadFile = async (entry: FileEntry) => {
    if (!path || transfer) return;
    const target = await saveFileDialog({ defaultPath: entry.name });
    if (!target) return;
    setTransfer(`Downloading ${entry.name}...`);
    setNotice(null);
    try {
      await api.sftpDownload(sessionId, joinPath(entry.name), target);
      setNotice(`Downloaded ${entry.name}`);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setTransfer(null);
    }
  };

  const uploadFile = async () => {
    if (!path || transfer) return;
    const selected = await openFileDialog({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await uploadPaths(paths);
  };

  const openEditor = async (entry: FileEntry) => {
    if (!path || transfer || entry.is_dir) return;
    const remote = joinPath(entry.name);
    setTransfer(`Opening ${entry.name}...`);
    setNotice(null);
    try {
      const contents = await api.sftpReadText(sessionId, remote);
      setEditor({
        remotePath: remote,
        name: entry.name,
        contents,
        dirty: false,
        saving: false,
      });
    } catch (err) {
      setNotice(String(err));
    } finally {
      setTransfer(null);
    }
  };

  const saveEditor = async () => {
    if (!editor || editor.saving) return;
    setEditor({ ...editor, saving: true });
    try {
      await api.sftpWriteText(sessionId, editor.remotePath, editor.contents);
      setEditor({ ...editor, dirty: false, saving: false });
      setNotice(`Saved ${editor.name}`);
      if (path) await load(path);
    } catch (err) {
      setEditor({ ...editor, saving: false });
      setNotice(String(err));
    }
  };

  return (
    <div
      ref={panelRef}
      className="file-browser-panel relative flex h-full w-[280px] shrink-0 flex-col border-l"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed"
          style={{
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            borderColor: "var(--accent)",
          }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
            Drop to upload
          </span>
        </div>
      )}

      {editor && (
        <div
          className="absolute inset-0 z-30 flex flex-col"
          style={{ background: "var(--bg-panel)" }}
        >
          <div
            className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "var(--text)" }}>
              {editor.name}
              {editor.dirty ? " *" : ""}
            </span>
            <button
              onClick={() => void saveEditor()}
              disabled={!editor.dirty || editor.saving}
              className="rounded px-2 py-1 text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {editor.saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                if (editor.dirty && !confirm("Discard unsaved changes?")) return;
                setEditor(null);
              }}
              className="hover-subtle rounded p-1.5"
              style={{ color: "var(--text-muted)" }}
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
          <textarea
            value={editor.contents}
            onChange={(e) =>
              setEditor({ ...editor, contents: e.target.value, dirty: true })
            }
            spellCheck={false}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 font-mono text-xs outline-none"
            style={{ color: "var(--text)" }}
          />
        </div>
      )}

      <div
        className="flex shrink-0 items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Files
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => void uploadFile()}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Upload file here"
          >
            <Upload size={13} />
          </button>
          <button
            onClick={() => void load(homePath ?? undefined)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Home"
          >
            <Home size={13} />
          </button>
          <button
            onClick={() => void load(path ?? undefined)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {path && (
            <button
              onClick={() => onCdTerminal(path)}
              className="hover-subtle rounded p-1.5"
              style={{ color: "var(--text-muted)" }}
              title="cd terminal here"
            >
              <TerminalSquare size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          onClick={() => path && void load(parentPath(path))}
          disabled={!path || path === "/"}
          className="hover-subtle rounded p-1 disabled:opacity-30"
          style={{ color: "var(--text-muted)" }}
          title="Up"
        >
          <ArrowUp size={13} />
        </button>
        <span
          className="select-text truncate text-xs"
          style={{ color: "var(--text-muted)" }}
          title={path ?? ""}
        >
          {path ?? "..."}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {error && (
          <div className="px-2 py-1 text-xs" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}
        {!error && !loading && entries.length === 0 && (
          <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Empty directory
          </div>
        )}
        {entries.map((entry) => {
          const Icon = entry.is_dir ? Folder : fileIcon(entry.name);
          return (
            <div
              key={entry.name}
              className="hover-subtle group transition-ui flex w-full items-center gap-1 rounded-md px-1 py-0.5"
            >
              <button
                onDoubleClick={() => {
                  if (entry.is_dir && path) {
                    void load(joinPath(entry.name));
                  } else if (!entry.is_dir && isLikelyTextFile(entry.name)) {
                    void openEditor(entry);
                  } else if (!entry.is_dir) {
                    void downloadFile(entry);
                  }
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                title={
                  entry.is_dir
                    ? "Double-click to open"
                    : isLikelyTextFile(entry.name)
                      ? "Double-click to edit"
                      : "Double-click to download"
                }
              >
                <Icon
                  size={14}
                  className="shrink-0"
                  style={{ color: entry.is_dir ? "var(--accent)" : "var(--text-muted)" }}
                />
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text)" }}>
                  {entry.name}
                </span>
                {!entry.is_dir && (
                  <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
              {!entry.is_dir && (
                <button
                  onClick={() => void openEditor(entry)}
                  className="hover-subtle shrink-0 rounded p-1 opacity-0 group-hover:opacity-100"
                  style={{ color: "var(--text-muted)" }}
                  title="Edit remote file"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {(transfer || notice) && (
        <div
          className="shrink-0 truncate border-t px-3 py-1.5 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: transfer ? "var(--accent)" : "var(--text-muted)",
          }}
          title={transfer ?? notice ?? ""}
        >
          {transfer ?? notice}
        </div>
      )}
    </div>
  );
}
