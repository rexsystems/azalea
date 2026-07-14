import { useEffect, useRef, useState } from "react";
import type { Snippet } from "@azalea/shared";
import { Play, Plus, Trash2, X } from "lucide-react";
import * as api from "../lib/api";

interface SnippetsPopoverProps {
  onRun: (command: string) => void;
  onClose: () => void;
}

export function SnippetsPopover({ onRun, onClose }: SnippetsPopoverProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = () => {
    void api.listSnippets().then(setSnippets).catch(() => setSnippets([]));
  };

  useEffect(refresh, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim() || !command.trim()) return;
    await api.createSnippet({ name: name.trim(), command: command.trim() });
    setName("");
    setCommand("");
    setAdding(false);
    refresh();
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-1 z-20 flex w-72 flex-col rounded-xl border shadow-xl"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Snippets
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setAdding((v) => !v)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="New snippet"
          >
            <Plus size={13} />
          </button>
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

      {adding && (
        <div className="flex flex-col gap-1.5 border-b px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border px-2 py-1 text-xs outline-none"
            style={{
              background: "var(--bg-base)",
              borderColor: "var(--border-subtle)",
              color: "var(--text)",
            }}
          />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Command (e.g. df -h)"
            className="rounded-md border px-2 py-1 font-mono text-xs outline-none"
            style={{
              background: "var(--bg-base)",
              borderColor: "var(--border-subtle)",
              color: "var(--text)",
            }}
          />
          <button
            onClick={() => void submit()}
            className="hover-subtle-active rounded-md px-2 py-1 text-xs font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
          >
            Save snippet
          </button>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto p-1.5">
        {snippets.length === 0 && !adding && (
          <div className="px-2 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
            No snippets yet. Click + to add one.
          </div>
        )}
        {snippets.map((snippet) => (
          <div
            key={snippet.id}
            className="hover-subtle group flex items-center gap-2 rounded-md px-2 py-1.5"
          >
            <button
              onClick={() => {
                onRun(snippet.command);
                onClose();
              }}
              className="flex min-w-0 flex-1 flex-col text-left"
              title={`Run: ${snippet.command}`}
            >
              <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                {snippet.name}
              </span>
              <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                {snippet.command}
              </span>
            </button>
            <Play size={12} className="shrink-0 opacity-0 group-hover:opacity-100" style={{ color: "var(--accent)" }} />
            <button
              onClick={() => {
                void api.deleteSnippet(snippet.id).then(refresh);
              }}
              className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100"
              style={{ color: "#f87171" }}
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
