import { useEffect, useState, type ReactNode } from "react";
import type { AiWorkSummary } from "../lib/ai";
import { formatWorkDuration } from "../lib/aiWeb";
import { ChevronDown } from "./icons";

export function AiWorkDetails({
  work,
  liveText,
  transcript = [],
  renderContent,
  footer,
}: {
  work: AiWorkSummary;
  liveText?: string;
  transcript?: string[];
  renderContent: (text: string, pending: boolean) => ReactNode;
  footer?: ReactNode;
}) {
  const active = work.status === "running" || work.status === "waiting";
  const [open, setOpen] = useState(active);
  const [now, setNow] = useState(Date.now());
  // Work is visible while running/awaiting approval; finishing collapses it once.
  // Afterwards the user can reopen it without the timer changing their choice.
  useEffect(() => {
    setOpen(work.status === "running" || work.status === "waiting");
  }, [work.status]);
  useEffect(() => {
    if (work.activeSince === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [work.activeSince]);
  const elapsed =
    work.elapsedMs +
    (work.activeSince === undefined ? 0 : Math.max(0, now - work.activeSince));
  const title =
    work.status === "running"
      ? `Working · ${formatWorkDuration(elapsed)}`
      : work.status === "waiting"
        ? "Waiting for approval"
        : `${work.status === "stopped" ? "Stopped after" : work.status === "error" ? "Failed after" : "Worked for"} ${formatWorkDuration(elapsed)}`;
  const latestTurn = [...work.events]
    .reverse()
    .find((event) => event.kind === "thinking");
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group text-[12px]"
    >
      <summary
        className="transition-ui flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 pr-1 text-[12px] [&::-webkit-details-marker]:hidden hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        style={{ color: "var(--text-secondary)" }}
      >
        <span>{title}</span>
        <ChevronDown
          size={12}
          className="shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-3 space-y-4">
        {work.events.map((event) => {
          const text =
            event.content ??
            (event.status === "running" && event.kind === "thinking"
              ? liveText
              : undefined);
          return (
            <div key={event.id} className="space-y-2">
              <div
                className="flex items-center justify-between gap-2 text-[12px]"
                style={{
                  color:
                    event.status === "error" ? "#f87171" : "var(--text-muted)",
                }}
              >
                <span className="min-w-0 break-words">{event.label}</span>
                {event.kind !== "thinking" && (
                  <span className="shrink-0 text-[10px]">
                    {event.status === "running"
                      ? event.status
                      : event.status === "error" ||
                          event.status === "rejected" ||
                          event.status === "stopped"
                        ? event.status
                        : ""}
                  </span>
                )}
              </div>
              {text &&
                event.id !== work.finalEventId &&
                renderContent(
                  text,
                  work.status === "waiting" && event.id === latestTurn?.id,
                )}
              {event.detail && (
                <pre
                  className="select-text max-h-48 overflow-auto rounded-xl border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {event.detail}
                </pre>
              )}
              {event.sources?.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={source.url}
                  className="block truncate text-[11px] underline decoration-transparent underline-offset-2 hover:decoration-current"
                  style={{ color: "var(--accent)" }}
                >
                  {source.title}
                </a>
              ))}
            </div>
          );
        })}
        {transcript.map((text, i) => (
          <div key={i}>{renderContent(text, false)}</div>
        ))}
        {footer}
      </div>
    </details>
  );
}
