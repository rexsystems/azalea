import { useCallback, useEffect, useState } from "react";
import type { FileEntry } from "@azalea/shared";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  File,
  FileCode,
  FileText,
  Folder,
  Home,
  RefreshCw,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import * as api from "../lib/api";

interface FileBrowserPanelProps {
  sessionId: string;
  onClose: () => void;
  onCdTerminal: (path: string) => void;
}

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
  if (["txt", "md", "log", "conf", "cfg", "ini", "yml", "yaml", "json", "toml", "env"].includes(ext)) {
    return FileText;
  }
  return File;
}

function parentPath(path: string): string {
  if (path === "/" || !path.includes("/")) return "/";
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

export function FileBrowserPanel({ sessionId, onClose, onCdTerminal }: FileBrowserPanelProps) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const selected = await openFileDialog({ multiple: false });
    if (!selected || typeof selected !== "string") return;
    const filename = selected.replace(/\\/g, "/").split("/").pop() ?? "upload";
    setTransfer(`Uploading ${filename}...`);
    setNotice(null);
    try {
      await api.sftpUpload(sessionId, selected, joinPath(filename));
      setNotice(`Uploaded ${filename}`);
      await load(path);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setTransfer(null);
    }
  };

  return (
    <div
      className="flex h-full w-[280px] shrink-0 flex-col border-l"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
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
            <button
              key={entry.name}
              onDoubleClick={() => {
                if (entry.is_dir && path) {
                  void load(joinPath(entry.name));
                } else if (!entry.is_dir) {
                  void downloadFile(entry);
                }
              }}
              className="hover-subtle transition-ui flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
              title={entry.is_dir ? "Double-click to open" : "Double-click to download"}
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
