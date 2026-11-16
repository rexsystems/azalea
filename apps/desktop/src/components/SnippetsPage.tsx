import { useCallback, useEffect, useState } from "react";
import type { Snippet } from "@azalea/shared";
import * as api from "../lib/api";
import { copyText } from "../lib/clipboard";
import { Check, Copy, Pencil, Play, Plus, Trash2 } from "./icons";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface SnippetsPageProps {
  /** The terminal tab a snippet would run in, or null when none is open. */
  runTarget?: { title: string } | null;
  onRun?: (command: string) => void;
}

/** Manage saved commands. Running one needs an open terminal tab to send it to. */
export function SnippetsPage({ runTarget = null, onRun }: SnippetsPageProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .listSnippets()
      .then(setSnippets)
      .catch((err) => setError(String(err)))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(refresh, [refresh]);

  const startEdit = (snippet: Snippet | null) => {
    setEditingId(snippet ? snippet.id : "new");
    setName(snippet?.name ?? "");
    setCommand(snippet?.command ?? "");
    setError(null);
  };

  const cancel = () => {
    setEditingId(null);
    setName("");
    setCommand("");
  };

  const save = async () => {
    const input = { name: name.trim(), command: command.trim() };
    if (!input.name || !input.command) {
      setError("A snippet needs a name and a command.");
      return;
    }
    try {
      if (editingId && editingId !== "new") await api.updateSnippet(editingId, input);
      else await api.createSnippet(input);
      cancel();
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const remove = async (snippet: Snippet) => {
    try {
      await api.deleteSnippet(snippet.id);
      if (editingId === snippet.id) cancel();
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const copy = async (snippet: Snippet) => {
    try {
      await copyText(snippet.command);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId((id) => (id === snippet.id ? null : id)), 1500);
    } catch (err) {
      setError(String(err));
    }
  };

  const editor = (
    <div
      className="space-y-3 rounded-xl border p-4"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      <Input
        label="Name"
        placeholder="Disk usage"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Input
        label="Command"
        placeholder="df -h"
        className="font-mono"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") cancel();
        }}
      />
      <div className="flex gap-2">
        <Button onClick={() => void save()}>Save</Button>
        <Button variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell flex min-h-0 flex-1 flex-col overflow-y-auto !pb-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
                style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
              >
                Snippets
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {runTarget
                  ? `Saved commands. Run sends the command to ${runTarget.title}.`
                  : "Saved commands. Open a terminal tab to run one."}
              </p>
            </div>
            {editingId === null && (
              <button
                type="button"
                onClick={() => startEdit(null)}
                className="home-action-primary transition-ui inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium"
              >
                <Plus size={16} />
                New snippet
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mb-4 text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          {editingId === "new" && <div className="mb-4">{editor}</div>}

          {loaded && snippets.length === 0 && editingId === null ? (
            <p
              className="rounded-xl border border-dashed px-4 py-8 text-center text-sm"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            >
              No snippets yet. Add a command you type often, like df -h.
            </p>
          ) : (
            snippets.length > 0 && (
              <ul
                className="overflow-hidden rounded-xl border"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
              >
                {snippets.map((snippet, index) => (
                  <li
                    key={snippet.id}
                    style={index > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined}
                  >
                    {editingId === snippet.id ? (
                      <div className="p-3">{editor}</div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
                        <div className="min-w-0 flex-1 basis-56">
                          <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                            {snippet.name}
                          </div>
                          <div
                            className="truncate font-mono text-xs"
                            style={{ color: "var(--text-muted)" }}
                            title={snippet.command}
                          >
                            {snippet.command}
                          </div>
                        </div>
                        <div className="key-card-actions flex items-center gap-0.5">
                          {runTarget && onRun && (
                            <button
                              type="button"
                              onClick={() => onRun(snippet.command)}
                              title={`Run in ${runTarget.title}`}
                            >
                              <Play size={14} />
                              <span>Run</span>
                            </button>
                          )}
                          <button type="button" onClick={() => void copy(snippet)}>
                            {copiedId === snippet.id ? <Check size={14} /> : <Copy size={14} />}
                            <span>{copiedId === snippet.id ? "Copied" : "Copy"}</span>
                          </button>
                          <button type="button" onClick={() => startEdit(snippet)}>
                            <Pencil size={14} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="key-action-danger"
                            onClick={() => void remove(snippet)}
                            title="Delete snippet"
                            aria-label={`Delete ${snippet.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
}
