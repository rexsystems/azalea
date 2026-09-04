import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FileEntry } from "@azalea/shared";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Copy,
  Download,
  File,
  FileCode,
  FileText,
  Folder,
  Home,
  Pencil,
  RefreshCw,
  Search,
  TerminalSquare,
  Upload,
  X,
} from "./icons";
import { copyText } from "../lib/clipboard";
import * as api from "../lib/api";
import { ContextMenu, type ContextMenuSection } from "./ui/ContextMenu";

interface FileBrowserPanelProps {
  sessionId: string;
  onClose: () => void;
  onCdTerminal: (path: string) => void;
}

const WIDTH_KEY = "azalea.sftp.panelWidth";
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 340;

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

function clampWidth(width: number): number {
  const max = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.55));
  return Math.max(MIN_WIDTH, Math.min(max, Math.round(width)));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
    return clampWidth(parsed);
  } catch {
    return DEFAULT_WIDTH;
  }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatMtime(mtime: number | null): string | null {
  if (mtime == null || mtime <= 0) return null;
  const ms = mtime < 1_000_000_000_000 ? mtime * 1000 : mtime;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
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
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const [editor, setEditor] = useState<{
    remotePath: string;
    name: string;
    contents: string;
    dirty: boolean;
    saving: boolean;
  } | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [pathEditing, setPathEditing] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

  const pathRef = useRef(path);
  const transferRef = useRef(transfer);
  const widthRef = useRef(width);
  pathRef.current = path;
  transferRef.current = transfer;
  widthRef.current = width;

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.sftpList(sessionId, target);
        setPath(result.path);
        setPathDraft(result.path);
        setPathEditing(false);
        setEntries(sortEntries(result.entries));
        setSelected(null);
        if (!target) setHomePath(result.path);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  const goToPath = (raw: string) => {
    const next = raw.trim() || "/";
    if (next === path) {
      setPathDraft(path ?? next);
      setPathEditing(false);
      return;
    }
    void load(next);
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const next = clampWidth(startWidth + (startX - ev.clientX));
      widthRef.current = next;
      setWidth(next);
    };

    const onUp = () => {
      setResizing(false);
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        // ignore
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const joinPath = (name: string) => (path === "/" ? `/${name}` : `${path}/${name}`);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [entries, filter]);

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
    if (!path || transfer || entry.is_dir) return;
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
    const selectedFiles = await openFileDialog({ multiple: true });
    if (!selectedFiles) return;
    const paths = Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
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

  const openEntry = (entry: FileEntry) => {
    if (entry.is_dir && path) {
      void load(joinPath(entry.name));
      return;
    }
    if (isLikelyTextFile(entry.name)) {
      void openEditor(entry);
      return;
    }
    void downloadFile(entry);
  };

  const menuSections = (entry: FileEntry): ContextMenuSection[] => {
    const remote = path ? joinPath(entry.name) : entry.name;
    const items = [
      {
        id: "open",
        label: entry.is_dir ? "Open folder" : isLikelyTextFile(entry.name) ? "Edit" : "Download",
        icon: entry.is_dir ? <Folder size={14} /> : isLikelyTextFile(entry.name) ? <Pencil size={14} /> : <Download size={14} />,
        onClick: () => openEntry(entry),
      },
    ];

    if (!entry.is_dir) {
      items.push({
        id: "download",
        label: "Download",
        icon: <Download size={14} />,
        onClick: () => void downloadFile(entry),
      });
      if (isLikelyTextFile(entry.name)) {
        items.push({
          id: "edit",
          label: "Edit in panel",
          icon: <Pencil size={14} />,
          onClick: () => void openEditor(entry),
        });
      }
    }

    items.push({
      id: "copy-path",
      label: "Copy path",
      icon: <Copy size={14} />,
      onClick: () => {
        void copyText(remote).then(() => setNotice("Path copied"));
      },
    });

    if (entry.is_dir) {
      items.push({
        id: "cd",
        label: "cd in terminal",
        icon: <TerminalSquare size={14} />,
        onClick: () => onCdTerminal(remote),
      });
    }

    return [{ items }];
  };

  const dirCount = filtered.filter((e) => e.is_dir).length;
  const fileCount = filtered.length - dirCount;

  return (
    <div
      ref={panelRef}
      className="file-browser-panel relative flex h-full shrink-0 flex-col border-l"
      style={{
        width,
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-label="Resize file browser"
        onPointerDown={startResize}
        className={`file-browser-resize absolute inset-y-0 left-0 z-40 w-1.5 cursor-col-resize${resizing ? " is-resizing" : ""}`}
        style={{ touchAction: "none" }}
      >
        <div className="file-browser-resize-line absolute inset-y-0 left-0 w-px" />
        <div className="absolute inset-y-0 -left-1 w-3" />
      </div>

      {resizing && (
        <div
          className="pointer-events-none absolute left-3 top-1/2 z-50 -translate-y-1/2 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums shadow-lg"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--accent)",
            color: "var(--text)",
          }}
        >
          {width}px
        </div>
      )}

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
              type="button"
              onClick={() => void saveEditor()}
              disabled={!editor.dirty || editor.saving}
              className="rounded px-2 py-1 text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
            >
              {editor.saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
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
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Files
          </div>
          <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
            SFTP
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void uploadFile()}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Upload file here"
          >
            <Upload size={13} />
          </button>
          <button
            type="button"
            onClick={() => void load(homePath ?? undefined)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Home"
          >
            <Home size={13} />
          </button>
          <button
            type="button"
            onClick={() => void load(path ?? undefined)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {path && (
            <button
              type="button"
              onClick={() => onCdTerminal(path)}
              className="hover-subtle rounded p-1.5"
              style={{ color: "var(--text-muted)" }}
              title="cd terminal here"
            >
              <TerminalSquare size={13} />
            </button>
          )}
          <button
            type="button"
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
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={() => path && void load(parentPath(path))}
          disabled={!path || path === "/"}
          className="hover-subtle rounded p-1 disabled:opacity-30"
          style={{ color: "var(--text-muted)" }}
          title="Up"
        >
          <ArrowUp size={13} />
        </button>
        <input
          value={pathEditing ? pathDraft : (path ?? "...")}
          onChange={(e) => {
            setPathEditing(true);
            setPathDraft(e.target.value);
          }}
          onFocus={() => {
            setPathEditing(true);
            setPathDraft(path ?? "/");
          }}
          onBlur={() => goToPath(pathDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setPathDraft(path ?? "/");
              setPathEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-[11px] outline-none"
          style={{
            color: "var(--text)",
            background: "var(--bg-base)",
            borderColor: "var(--border-subtle)",
          }}
          title="Type a path and press Enter"
          aria-label="Remote path"
        />
      </div>

      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Search size={13} style={{ color: "var(--text-muted)" }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none"
          style={{ color: "var(--text)" }}
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter("")}
            className="hover-subtle rounded p-0.5"
            style={{ color: "var(--text-muted)" }}
            title="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {error && (
          <div className="px-2 py-1 text-xs" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}
        {!error && loading && entries.length === 0 && (
          <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Loading…
          </div>
        )}
        {!error && !loading && filtered.length === 0 && (
          <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {filter.trim() ? "No matches" : "Empty directory"}
          </div>
        )}
        {filtered.map((entry) => {
          const Icon = entry.is_dir ? Folder : fileIcon(entry.name);
          const mtime = formatMtime(entry.mtime);
          const isSelected = selected === entry.name;
          return (
            <div
              key={entry.name}
              className="group transition-ui flex w-full items-center gap-0.5 rounded-md px-0.5 py-0.5"
              style={{
                background: isSelected
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : undefined,
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected(entry.name);
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <button
                type="button"
                onClick={() => setSelected(entry.name)}
                onDoubleClick={() => openEntry(entry)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left"
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" style={{ color: "var(--text)" }}>
                    {entry.name}
                  </span>
                  {mtime && (
                    <span className="block truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {mtime}
                    </span>
                  )}
                </span>
                {!entry.is_dir && (
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
              {!entry.is_dir && (
                <>
                  <button
                    type="button"
                    onClick={() => void downloadFile(entry)}
                    className="hover-subtle shrink-0 rounded p-1 opacity-0 group-hover:opacity-100"
                    style={{ color: "var(--text-muted)" }}
                    title="Download"
                  >
                    <Download size={12} />
                  </button>
                  {isLikelyTextFile(entry.name) && (
                    <button
                      type="button"
                      onClick={() => void openEditor(entry)}
                      className="hover-subtle shrink-0 rounded p-1 opacity-0 group-hover:opacity-100"
                      style={{ color: "var(--text-muted)" }}
                      title="Edit remote file"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px]"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        <span>
          {dirCount} folder{dirCount === 1 ? "" : "s"} · {fileCount} file{fileCount === 1 ? "" : "s"}
        </span>
        <span className="truncate tabular-nums">
          {resizing ? `${width}px` : (transfer ?? notice ?? "Drag left edge to resize")}
        </span>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          sections={menuSections(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
