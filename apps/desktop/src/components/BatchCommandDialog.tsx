import { useEffect, useRef, useState } from "react";
import type { Host, Snippet } from "@azalea/shared";
import * as api from "../lib/api";
import { applyBatchEvent, batchStatusLabel, type BatchResult } from "../lib/batch";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useHideHostAddresses } from "../hooks/useHideHostAddresses";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";
import { useBatchSettings } from "../hooks/useBatchSettings";
import { batchTimeoutLabel, batchTimeoutSeconds } from "../lib/batchSettings";

interface Props {
  hosts: Host[];
  onClose: () => void;
}

export function BatchCommandDialog({ hosts, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLParagraphElement>(null);
  const activeBatch = useRef<string | null>(null);
  const mounted = useRef(true);
  const [selected, setSelected] = useState(() => new Set(hosts.map((host) => host.id)));
  const [command, setCommand] = useState("");
  const { settings: batchSettings } = useBatchSettings();
  const [snippetId, setSnippetId] = useState("");
  const [runTimeout, setRunTimeout] = useState<number | null>(null);
  const timeout = batchTimeoutSeconds(batchSettings);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetState, setSnippetState] = useState<"loading" | "ready" | "failed">("loading");
  const [snippetAttempt, setSnippetAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, BatchResult> | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hideAddress = useHideHostAddresses();
  const close = () => {
    if (!activeBatch.current) onClose();
  };
  useDialogFocus(true, dialog, close);
  const hasResults = results !== null;
  useEffect(() => {
    if (hasResults) progress.current?.focus();
    else dialog.current?.querySelector("textarea")?.focus();
  }, [hasResults]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeBatch.current) void api.cancelBatchCommand(activeBatch.current).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setSnippetState("loading");
    void api
      .listSnippets()
      .then((items) => {
        if (!disposed) {
          setSnippets(items);
          setSnippetState("ready");
        }
      })
      .catch(() => {
        if (!disposed) setSnippetState("failed");
      });
    return () => {
      disposed = true;
    };
  }, [snippetAttempt]);

  const run = async () => {
    if (activeBatch.current || !command.trim() || !selected.size) return;
    const batchId = crypto.randomUUID();
    activeBatch.current = batchId;
    setError(null);
    setRunTimeout(timeout);
    setRunning(true);
    setStopping(false);
    setResults(
      Object.fromEntries(
        hosts
          .filter((host) => selected.has(host.id))
          .map((host) => [
            host.id,
            {
              status: "queued",
              output: [],
              exitCode: null,
              error: null,
            },
          ]),
      ),
    );
    let failure: string | null = null;
    try {
      await api.runBatchCommand(batchId, [...selected], command, timeout, (event) => {
        if (mounted.current && activeBatch.current === batchId)
          setResults((previous) => (previous ? applyBatchEvent(previous, event) : previous));
      });
    } catch (err) {
      failure = String(err);
      if (mounted.current) setError(failure);
    } finally {
      activeBatch.current = null;
      if (mounted.current) {
        setRunning(false);
        setStopping(false);
        setResults(
          (previous) =>
            previous &&
            Object.fromEntries(
              Object.entries(previous).map(([id, result]) => [
                id,
                result.status === "queued" || result.status === "running"
                  ? {
                      ...result,
                      status: "failed",
                      error: failure ?? "No final result received. Execution outcome is unknown.",
                    }
                  : result,
              ]),
            ),
        );
      }
    }
  };

  const stop = async () => {
    if (!activeBatch.current) return;
    setStopping(true);
    try {
      await api.cancelBatchCommand(activeBatch.current);
    } catch (err) {
      setError(String(err));
      setStopping(false);
    }
  };

  const finished = Object.values(results ?? {}).filter(
    (result) => result.status !== "running" && result.status !== "queued",
  ).length;
  const fieldStyle = {
    background: "var(--bg-input)",
    borderColor: "var(--border-subtle)",
    color: "var(--text)",
  };
  const fieldClass =
    "w-full rounded-lg border px-3 py-2 text-sm placeholder:text-[var(--text-secondary)] placeholder:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-title"
        aria-describedby="batch-description"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          color: "var(--text)",
        }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b p-4 sm:p-5"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div>
            <h2 id="batch-title" className="text-lg font-semibold">
              Run command on hosts
            </h2>
            <p
              id="batch-description"
              className="mt-1 text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              Separate SSH sessions, up to 4 hosts at a time.
            </p>
          </div>
          <Button variant="secondary" disabled={running} onClick={close}>
            Close
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
          {!results ? (
            <form
              id="batch-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run();
              }}
              className="space-y-4"
            >
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Targets ({selected.size})</legend>
                <div
                  className="max-h-48 overflow-y-auto rounded-lg border"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {hosts.map((host) => (
                    <Checkbox
                      key={host.id}
                      label={host.name}
                      description={
                        hideAddress ? undefined : `${host.username}@${host.hostname}:${host.port}`
                      }
                      checked={selected.has(host.id)}
                      onChange={(checked) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(host.id);
                          else next.delete(host.id);
                          return next;
                        })
                      }
                      className="batch-command-controls min-h-11 rounded-lg px-3 py-2 [--text-muted:var(--text-secondary)] [&>span:last-child]:break-words focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    />
                  ))}
                </div>
                {hosts.length === 0 && (
                  <p className="mt-2 text-sm">Select hosts from the Hosts page first.</p>
                )}
                {selected.size > 100 && (
                  <p role="alert" className="mt-2 text-sm">
                    Select at most 100 hosts per batch.
                  </p>
                )}
              </fieldset>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Connect normally to each host first to accept its server key. Commands run without
                an interactive terminal; prompts for passwords or input are unsupported.
              </p>
              <div>
                <Select
                  label="Saved snippet"
                  value={snippetId}
                  disabled={snippetState !== "ready" || !snippets.length}
                  options={[
                    {
                      value: "",
                      label:
                        snippetState === "loading"
                          ? "Loading snippets…"
                          : snippetState === "failed"
                            ? "Snippets unavailable"
                            : snippets.length
                              ? "Choose a snippet"
                              : "No saved snippets",
                    },
                    ...snippets.map((snippet) => ({ value: snippet.id, label: snippet.name })),
                  ]}
                  onChange={(value) => {
                    setSnippetId(value);
                    const snippet = snippets.find((item) => item.id === value);
                    if (snippet) setCommand(snippet.command);
                  }}
                  className="[--text-muted:var(--text-secondary)] [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-[var(--accent)]"
                />
                {snippetState === "failed" && (
                  <div role="alert" className="mt-2 text-sm">
                    Could not load snippets.{" "}
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => setSnippetAttempt((value) => value + 1)}
                    >
                      Retry snippets
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="batch-command" className="mb-1 block text-sm font-medium">
                  Command
                </label>
                <textarea
                  id="batch-command"
                  required
                  rows={4}
                  maxLength={65536}
                  spellCheck={false}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className={`${fieldClass} resize-y font-mono`}
                  style={fieldStyle}
                  placeholder="uptime"
                />
              </div>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Timeout: {batchTimeoutLabel(timeout)}. Change in Settings → Terminal → Batch
                commands.
              </p>
            </form>
          ) : (
            <div className="space-y-3">
              <pre
                className="whitespace-pre-wrap break-words rounded-lg border p-3 text-sm"
                style={fieldStyle}
              >
                {command}
              </pre>
              <p ref={progress} tabIndex={-1} role="status" aria-live="polite" className="text-sm">
                {finished} / {Object.keys(results).length} hosts finished
                {stopping ? " · Stopping…" : running ? " · Running…" : ""}
              </p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Timeout: {batchTimeoutLabel(runTimeout)}.
              </p>
              {hosts
                .filter((host) => results[host.id])
                .map((host) => {
                  const result = results[host.id];
                  return (
                    <details
                      key={host.id}
                      open
                      className="rounded-lg border"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <summary className="min-h-11 cursor-pointer break-words px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <span className="font-medium">{host.name}</span>
                        <span className="ml-3">
                          {batchStatusLabel[result.status]}
                          {result.exitCode !== null ? ` · Exit ${result.exitCode}` : ""}
                        </span>
                      </summary>
                      <div className="px-3 pb-3">
                        {result.output.length > 0 ? (
                          <pre
                            tabIndex={0}
                            aria-label={`Output for ${host.name}`}
                            className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            style={{ background: "var(--bg-base)", color: "var(--text)" }}
                          >
                            {result.output.map((chunk, index) => (
                              <span key={index}>
                                {chunk.stderr ? (
                                  <span
                                    className="select-none"
                                    style={{ color: "var(--text-secondary)" }}
                                  >
                                    [stderr]{" "}
                                  </span>
                                ) : null}
                                {chunk.text}
                              </span>
                            ))}
                          </pre>
                        ) : (
                          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                            {result.status === "queued"
                              ? "Waiting for a free slot."
                              : result.status === "running"
                                ? "Waiting for output…"
                                : "No output."}
                          </p>
                        )}
                        {result.error && <p className="mt-2 break-words text-sm">{result.error}</p>}
                      </div>
                    </details>
                  );
                })}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 break-words text-sm">
              {error}
            </p>
          )}
        </div>
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t p-4 sm:px-5"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <p className="max-w-md text-xs" style={{ color: "var(--text-secondary)" }}>
            {results
              ? "Stopping or timing out closes SSH connections. Remote processes may continue."
              : "Review the command and targets before running. Output is limited to 1 MiB per host."}
          </p>
          {running ? (
            <Button variant="secondary" disabled={stopping} onClick={() => void stop()}>
              {stopping ? "Stopping…" : "Stop batch"}
            </Button>
          ) : results ? (
            <Button
              type="button"
              variant="secondary"
              onClick={(event) => {
                event.preventDefault();
                setResults(null);
                setError(null);
              }}
            >
              Edit command
            </Button>
          ) : (
            <Button
              type="submit"
              form="batch-form"
              className="batch-command-run"
              disabled={!command.trim() || selected.size === 0 || selected.size > 100}
            >
              Run on {selected.size} host{selected.size === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
