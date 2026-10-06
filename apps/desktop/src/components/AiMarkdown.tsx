import type { ReactNode } from "react";
import type { AiPendingAction } from "../lib/ai";
import { pendingActionKey } from "../lib/ai";
import { Button } from "./ui/Button";

function parseWriteHeader(lang: string): string | null {
  const m = /^write\s+path=(.+)$/i.exec(lang.trim());
  return m ? m[1].trim() : null;
}

function findPending(
  pending: AiPendingAction[] | undefined,
  action: AiPendingAction,
): AiPendingAction | undefined {
  if (!pending?.length) return undefined;
  const key = pendingActionKey(action);
  return pending.find((p) => pendingActionKey(p) === key);
}

/** Lightweight markdown for AI chat: paragraphs, bold, inline code, fenced blocks. */
export function AiMarkdown({
  text,
  onRunCommand,
  onInsertCommand,
  onWriteFile,
  onSaveSnippet,
  pendingApprove,
  onApprove,
}: {
  text: string;
  onRunCommand?: (command: string) => void;
  onInsertCommand?: (command: string) => void;
  onWriteFile?: (path: string, content: string) => void;
  onSaveSnippet?: (command: string) => void;
  pendingApprove?: AiPendingAction[];
  onApprove?: (action: AiPendingAction) => void;
}) {
  const parts = splitMarkdown(text);
  return (
    <div className="space-y-3 text-[14px] leading-[1.65]" style={{ color: "var(--text)" }}>
      {parts.map((part, i) => {
        if (part.type === "code") {
          const writePath = parseWriteHeader(part.lang);
          const isWrite = Boolean(writePath);
          const langNorm = part.lang.trim().toLowerCase();
          const isShell = !isWrite && /^(bash|sh|shell|zsh)?$/.test(langNorm);
          const shellAction: AiPendingAction | null = isShell
            ? { type: "shell", command: part.code }
            : null;
          const writeAction: AiPendingAction | null =
            isWrite && writePath ? { type: "write", path: writePath, content: part.code } : null;
          const awaiting = shellAction
            ? findPending(pendingApprove, shellAction)
            : writeAction
              ? findPending(pendingApprove, writeAction)
              : undefined;

          return (
            <div
              key={i}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
            >
              <div
                className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5 text-[11px] font-medium"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                <span className="min-w-0 truncate">
                  {isWrite ? `write ${writePath}` : part.lang || "code"}
                </span>
                {(isShell || isWrite) && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {awaiting ? (
                      <Button
                        size="sm"
                        onClick={() => onApprove?.(awaiting)}
                      >
                        Approve
                      </Button>
                    ) : (
                      <>
                        {isShell && onInsertCommand && (
                          <Button size="sm" variant="ghost" onClick={() => onInsertCommand(part.code)}>
                            Insert
                          </Button>
                        )}
                        {isShell && onRunCommand && (
                          <Button size="sm" variant="secondary" onClick={() => onRunCommand(part.code)}>
                            Run
                          </Button>
                        )}
                        {isShell && onSaveSnippet && (
                          <Button size="sm" variant="ghost" onClick={() => onSaveSnippet(part.code)}>
                            Save snippet
                          </Button>
                        )}
                        {isWrite && writePath && onWriteFile && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onWriteFile(writePath, part.code)}
                          >
                            Write
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <pre
                className="select-text overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--text)" }}
              >
                {part.code}
              </pre>
            </div>
          );
        }
        return (
          <p key={i} className="select-text whitespace-pre-wrap" style={{ color: "var(--text)" }}>
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
      lang: (m[1] || "").trim(),
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
          style={{ background: "var(--bg-card)", color: "var(--text)" }}
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
