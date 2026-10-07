import { isValidElement, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, Nodes } from "mdast";
import {
  parseSuggestedActions,
  pendingActionsEqual,
  type AiPendingAction,
} from "../lib/ai";
import { copyText } from "../lib/clipboard";
import { Button } from "./ui/Button";

function CopyCode({ code }: { code: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      title="Copy code"
      aria-label={status === "copied" ? "Code copied" : "Copy code"}
      onClick={() => {
        void copyText(code)
          .then(() => setStatus("copied"))
          .catch(() => setStatus("failed"));
      }}
    >
      {status === "copied"
        ? "Copied"
        : status === "failed"
          ? "Copy failed"
          : "Copy"}
    </Button>
  );
}

function actionHeaders() {
  return (tree: Root) => {
    const walk = (node: Nodes) => {
      if (node.type === "code") {
        node.data = {
          ...node.data,
          hProperties: {
            "data-ai-header": [node.lang, node.meta].filter(Boolean).join(" "),
          },
        };
      }
      if ("children" in node) node.children.forEach(walk);
    };
    walk(tree);
  };
}

export function AiMarkdown({
  text,
  onRunCommand,
  onInsertCommand,
  onWriteFile,
  onSaveSnippet,
  pendingApprove,
  onApprove,
  disabled = false,
}: {
  text: string;
  onRunCommand?: (command: string) => void;
  onInsertCommand?: (command: string) => void;
  onWriteFile?: (path: string, content: string) => void;
  onSaveSnippet?: (command: string) => void;
  pendingApprove?: AiPendingAction[];
  onApprove?: (action: AiPendingAction) => void;
  disabled?: boolean;
}) {
  const heading = "select-text font-semibold leading-snug";
  return (
    <div
      className="ai-markdown space-y-3 text-[14px] leading-[1.7] break-words"
      style={{ color: "var(--text)" }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, actionHeaders]}
        components={{
          h1: ({ children }) => (
            <h1 className={`${heading} text-xl`}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className={`${heading} text-lg`}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className={`${heading} text-base`}>{children}</h3>
          ),
          h4: ({ children }) => <h4 className={heading}>{children}</h4>,
          h5: ({ children }) => <h5 className={heading}>{children}</h5>,
          h6: ({ children }) => <h6 className={heading}>{children}</h6>,
          p: ({ children }) => (
            <p className="select-text whitespace-pre-wrap">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children, start }) => (
            <ol start={start} className="list-decimal space-y-1 pl-5">
              {children}
            </ol>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="space-y-2 border-l-2 pl-3"
              style={{
                borderColor: "var(--accent)",
                color: "var(--text-secondary)",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr style={{ borderColor: "var(--border-subtle)" }} />,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: "var(--accent)" }}
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div
              className="overflow-x-auto rounded-lg border"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <table className="w-full border-collapse text-[12px]">
                {children}
              </table>
            </div>
          ),
          th: ({ children, style }) => (
            <th
              className="border-b px-3 py-2 text-left font-semibold"
              style={{
                ...style,
                borderColor: "var(--border-subtle)",
                background: "var(--bg-card)",
              }}
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td
              className="border-b px-3 py-2"
              style={{ ...style, borderColor: "var(--border-subtle)" }}
            >
              {children}
            </td>
          ),
          code: ({ children, className, node: _node, ...props }) => (
            <code
              {...props}
              className={
                className || "rounded px-1 py-0.5 font-mono text-[12px]"
              }
              style={{ background: "var(--bg-card)" }}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => {
            if (!isValidElement(children)) return <pre>{children}</pre>;
            const props = children.props as {
              children?: ReactNode;
              node?: { properties?: Record<string, unknown> };
              className?: string;
            };
            const lang = String(
              props.node?.properties?.["data-ai-header"] ??
                props.node?.properties?.dataAiHeader ??
                props.className?.replace(/^language-/, "") ??
                "",
            );
            const code = String(props.children ?? "").replace(/\n$/, "");
            const action = parseSuggestedActions(
              `\`\`\`${lang}\n${code}\n\`\`\``,
            )[0];
            const awaiting =
              action &&
              pendingApprove?.find((p) => pendingActionsEqual(p, action));
            const writePath = action?.type === "write" ? action.path : null;
            return (
              <div
                className="overflow-hidden rounded-xl border"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "var(--bg-card)",
                }}
              >
                <div
                  className="flex min-h-8 items-center justify-between gap-2 border-b px-3 py-1 text-[10px] font-medium"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span className="min-w-0 truncate">
                    {writePath ? `write ${writePath}` : lang || "code"}
                  </span>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <CopyCode code={code} />
                    {awaiting ? (
                      <Button
                        type="button"
                        size="xs"
                        disabled={disabled || awaiting !== pendingApprove?.[0]}
                        onClick={() => onApprove?.(awaiting)}
                      >
                        Approve
                      </Button>
                    ) : (
                      <>
                        {action?.type === "shell" && onInsertCommand && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => onInsertCommand(action.command)}
                          >
                            Insert
                          </Button>
                        )}
                        {action?.type === "shell" && onRunCommand && (
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={disabled}
                            onClick={() => onRunCommand(action.command)}
                          >
                            Run
                          </Button>
                        )}
                        {action?.type === "shell" && onSaveSnippet && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => onSaveSnippet(action.command)}
                          >
                            Save snippet
                          </Button>
                        )}
                        {action?.type === "write" && onWriteFile && (
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={disabled}
                            onClick={() =>
                              onWriteFile(action.path, action.content)
                            }
                          >
                            Write
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <pre className="select-text overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap">
                  {code}
                </pre>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
