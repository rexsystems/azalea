import { useEffect, useState } from "react";
import type { AiWorkSummary } from "../lib/ai";
import { formatWorkDuration } from "../lib/aiWeb";
import { Check, ChevronDown, Clock, X } from "./icons";

export function AiWorkDetails({ work }: { work: AiWorkSummary }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (work.activeSince === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [work.activeSince]);
  const elapsed = work.elapsedMs + (work.activeSince === undefined ? 0 : Math.max(0, now - work.activeSince));
  const actions = work.events.filter((event) => ["search", "command", "write"].includes(event.kind));
  const finished = actions.filter((event) => event.status === "done").length;
  const title = work.status === "running" ? `Working · ${formatWorkDuration(elapsed)}`
    : work.status === "waiting" ? `Waiting for approval · ${formatWorkDuration(elapsed)} worked`
    : `${work.status === "stopped" ? "Stopped after" : "Worked for"} ${formatWorkDuration(elapsed)}`;
  return (
    <details className="group overflow-hidden rounded-xl border text-[12px]" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
      <summary className="hover-subtle transition-ui flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        style={{ color: "var(--text-secondary)" }}>
        {work.status === "done" ? <Check size={13} /> : <Clock size={13} />}
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {actions.length > 0 && <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{finished}/{actions.length} actions</span>}
        <ChevronDown size={12} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
        {work.events.map((event) => (
          <div key={event.id} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0" style={{ color: event.status === "error" ? "#f87171" : "var(--text-muted)" }}>
              {event.status === "done" ? <Check size={12} /> : event.status === "error" || event.status === "rejected" || event.status === "stopped" ? <X size={12} /> : <Clock size={12} />}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                <span className="break-words">{event.label}</span>
                <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{event.finishedAt === undefined ? event.status : formatWorkDuration(event.finishedAt - event.startedAt)}</span>
              </div>
              {event.detail && <details className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                <summary className="cursor-pointer">{event.kind === "command" || event.kind === "write" ? "View output" : "View details"}</summary>
                <pre className="select-text mt-1 max-h-48 overflow-auto rounded-lg border p-2 font-mono text-[11px] whitespace-pre-wrap" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>{event.detail}</pre>
              </details>}
              {event.sources?.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"
                className="block truncate text-[11px] underline decoration-transparent underline-offset-2 hover:decoration-current" style={{ color: "var(--accent)" }} title={source.url}>{source.title}</a>)}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
