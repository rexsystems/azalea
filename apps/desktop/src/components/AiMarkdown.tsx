import type { ReactNode } from "react";
import { Button } from "./ui/Button";

/** Lightweight markdown for AI chat: paragraphs, bold, inline code, fenced blocks. */
export function AiMarkdown({
  text,
  onRunCommand,
  onInsertCommand,
  pendingApprove,
  onApprove,
}: {
  text: string;
  onRunCommand?: (command: string) => void;
  onInsertCommand?: (command: string) => void;
  pendingApprove?: string[];
  onApprove?: (command: string) => void;
}) {
  const parts = splitMarkdown(text);
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
      {parts.map((part, i) => {
        if (part.type === "code") {
          const isShell = /^(bash|sh|shell|zsh)?$/.test(part.lang);
          const awaiting = pendingApprove?.includes(part.code);
          return (
            <div
              key={i}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
            >
              <div
                className="flex items-center justify-between border-b px-2.5 py-1.5 text-[10px] uppercase tracking-wider"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                <span>{part.lang || "code"}</span>
                {isShell && (onRunCommand || onInsertCommand || awaiting) && (
                  <div className="flex gap-1 normal-case tracking-normal">
                    {awaiting ? (
                      <Button size="sm" onClick={() => onApprove?.(part.code)}>
                        Approve
                      </Button>
                    ) : (
                      <>
                        {onInsertCommand && (
                          <Button size="sm" variant="ghost" onClick={() => onInsertCommand(part.code)}>
                            Insert
                          </Button>
                        )}
                        {onRunCommand && (
                          <Button size="sm" variant="secondary" onClick={() => onRunCommand(part.code)}>
                            Run
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <pre
                className="select-text overflow-x-auto px-3 py-2.5 font-mono text-[12px] whitespace-pre-wrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {part.code}
              </pre>
            </div>
          );
        }
        return (
          <p key={i} className="select-text whitespace-pre-wrap">
            {renderInline(part.text)}
          </p>
        );
      })}
    </div>
  );
}

type Part =
  | { type: "text"; text: string }
  | { type: "code"; lang: string; code: string };

function splitMarkdown(source: string): Part[] {
  const parts: Part[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > last) {
      parts.push({ type: "text", text: source.slice(last, m.index).trim() });
    }
    parts.push({
      type: "code",
      lang: (m[1] || "").trim().toLowerCase(),
      code: m[2].replace(/\n$/, ""),
    });
    last = m.index + m[0].length;
  }
  const rest = source.slice(last).trim();
  if (rest) parts.push({ type: "text", text: rest });
  if (parts.length === 0 && source) parts.push({ type: "text", text: source });
  return parts.filter((p) => (p.type === "text" ? p.text.length > 0 : true));
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded px-1 py-0.5 font-mono text-[12px]"
          style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={key++} style={{ color: "var(--text)" }}>
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
