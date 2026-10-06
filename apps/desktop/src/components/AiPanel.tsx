import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Plus, RefreshCw, Square, X, Zap } from "./icons";
import {
  AI_PROVIDERS,
  BEDROCK_MANTLE_REGIONS,
  BEDROCK_RUNTIME_REGIONS,
  buildSystemPrompt,
  deleteAiThread,
  getAiPrefs,
  getAiThread,
  getProvider,
  listAiThreads,
  newAiThreadId,
  parseSuggestedCommands,
  resolveProviderBaseUrl,
  saveAiThread,
  setAiPrefs,
  type AiAccess,
  type AiChatMessageStored,
  type AiChatThread,
  type AiMode,
  type AiModelOption,
  type AiProviderId,
} from "../lib/ai";
import * as api from "../lib/api";
import { AiMarkdown } from "./AiMarkdown";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";

interface AiPanelProps {
  sessionId: string;
  osId?: string | null;
  onInsertCommand: (command: string) => void;
  onRunCommand: (command: string) => void;
  onClose: () => void;
  getTerminalContext?: () => string;
}

const WIDTH_KEY = "azalea.ai.panelWidth";
const MIN_WIDTH = 320;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 400;

export function AiPanel({
  sessionId,
  osId,
  onInsertCommand,
  onRunCommand,
  onClose,
  getTerminalContext,
}: AiPanelProps) {
  const [prefs, setPrefsState] = useState(() => getAiPrefs());
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored)) : DEFAULT_WIDTH;
  });
  const [threads, setThreads] = useState<AiChatThread[]>(() => listAiThreads(sessionId));
  const [threadId, setThreadId] = useState<string>(() => threads[0]?.id ?? newAiThreadId());
  const [messages, setMessages] = useState<AiChatMessageStored[]>(() => threads[0]?.messages ?? []);
  const [pendingApprove, setPendingApprove] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<AiModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const provider = getProvider(prefs.providerId);
  const derivedUrl = resolveProviderBaseUrl(
    prefs.providerId,
    prefs.region,
    prefs.customBaseUrl,
  );

  const modelOptions = useMemo(() => {
    const base = liveModels ?? provider.models;
    const ids = new Set(base.map((m) => m.id));
    if (prefs.model && !ids.has(prefs.model)) {
      return [{ id: prefs.model, label: prefs.model }, ...base];
    }
    return base;
  }, [liveModels, provider.models, prefs.model]);

  const regionOptions = useMemo(() => {
    if (provider.regionKind === "bedrock_mantle") {
      return BEDROCK_MANTLE_REGIONS.map((r) => ({ value: r, label: r }));
    }
    if (provider.regionKind === "bedrock_runtime") {
      return BEDROCK_RUNTIME_REGIONS.map((r) => ({ value: r, label: r }));
    }
    return [];
  }, [provider.regionKind]);

  const patchPrefs = (patch: Partial<typeof prefs>) => {
    setAiPrefs(patch);
    setPrefsState(getAiPrefs());
  };

  const persist = (nextMessages: AiChatMessageStored[], id = threadId) => {
    const title =
      nextMessages.find((m) => m.role === "user")?.content.slice(0, 48) || "New chat";
    const thread: AiChatThread = {
      id,
      sessionId,
      title,
      messages: nextMessages,
      updatedAt: Date.now(),
    };
    saveAiThread(thread);
    setThreads(listAiThreads(sessionId));
  };

  useEffect(() => {
    const list = listAiThreads(sessionId);
    setThreads(list);
    if (list[0]) {
      setThreadId(list[0].id);
      setMessages(list[0].messages);
    } else {
      const id = newAiThreadId();
      setThreadId(id);
      setMessages([]);
    }
    setPendingApprove([]);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    setLiveModels(null);
    if (!provider.supportsModelList) return;
    setLoadingModels(true);
    void api
      .aiApiKeyPresent(prefs.providerId)
      .then(async (present) => {
        if (!present || cancelled) return;
        const models = await api.aiListModels(prefs.providerId, derivedUrl);
        if (!cancelled && models.length) {
          setLiveModels(models.map((m) => ({ id: m.id, label: m.label || m.id })));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prefs.providerId, prefs.region, prefs.customBaseUrl, derivedUrl, provider.supportsModelList]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<api.AiStreamEvent>("ai-stream", (event) => {
      const payload = event.payload;
      if (!requestIdRef.current || payload.requestId !== requestIdRef.current) return;
      if (payload.kind === "delta" && payload.text) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.id === streamingId) {
            next[next.length - 1] = { ...last, content: last.content + payload.text };
          }
          return next;
        });
      } else if (payload.kind === "error") {
        setError(payload.text || "Stream failed");
        setBusy(false);
        setStreamingId(null);
        requestIdRef.current = null;
      } else if (payload.kind === "done") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            const commands = parseSuggestedCommands(last.content);
            if (prefs.mode === "agent" && prefs.access === "full") {
              for (const command of commands) onRunCommand(command);
              setPendingApprove([]);
            } else if (prefs.mode === "agent" && prefs.access === "confirm") {
              setPendingApprove(commands);
            } else {
              setPendingApprove([]);
            }
            persist(prev);
          }
          return prev;
        });
        setBusy(false);
        setStreamingId(null);
        requestIdRef.current = null;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [streamingId, prefs.mode, prefs.access, onRunCommand, threadId, sessionId]);

  const startNewChat = () => {
    const id = newAiThreadId();
    setThreadId(id);
    setMessages([]);
    setPendingApprove([]);
    setError(null);
  };

  const loadThread = (id: string) => {
    const thread = getAiThread(sessionId, id);
    if (!thread) return;
    setThreadId(id);
    setMessages(thread.messages);
    setPendingApprove([]);
    setError(null);
  };

  const stop = () => {
    if (requestIdRef.current) {
      void api.aiChatCancel(requestIdRef.current);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setPendingApprove([]);

    const userMsg: AiChatMessageStored = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: AiChatMessageStored = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    const nextMessages = [...messages, userMsg, assistantMsg];
    setMessages(nextMessages);
    setStreamingId(assistantId);
    setBusy(true);
    persist(nextMessages);

    const context =
      prefs.includeTerminalContext ? (getTerminalContext?.().trim() ?? "") : "";
    const history = nextMessages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .slice(0, -1)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    const payload = [
      { role: "system", content: buildSystemPrompt(prefs.mode, prefs.access, osId) },
      ...(context
        ? [
            {
              role: "system" as const,
              content: `Recent terminal output (truncated):\n\`\`\`\n${context.slice(-8000)}\n\`\`\``,
            },
          ]
        : []),
      ...history,
      { role: "user", content: text },
    ];

    const requestId = `req-${Date.now()}`;
    requestIdRef.current = requestId;
    try {
      await api.aiChatStream(requestId, {
        providerId: prefs.providerId,
        dialect: provider.dialect,
        baseUrl: derivedUrl,
        model: prefs.model,
        messages: payload,
      });
    } catch (err) {
      setError(String(err));
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
    }
  };

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startX - e.clientX;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startW + delta));
    setWidth(next);
  };

  const onResizePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    localStorage.setItem(WIDTH_KEY, String(width));
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l"
      style={{
        width,
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="absolute top-0 bottom-0 left-0 z-10 w-1 cursor-col-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        style={{ background: "transparent" }}
      />

      <header
        className="flex items-center justify-between gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Zap size={16} />
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Chat
            </div>
            <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
              {prefs.mode === "agent" ? "Agent" : "Ask"} · {prefs.model}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="hover-subtle rounded-lg p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="New chat"
            onClick={startNewChat}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="hover-subtle rounded-lg p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Close"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="space-y-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={prefs.mode}
            options={[
              { value: "ask", label: "Ask" },
              { value: "agent", label: "Agent" },
            ]}
            onChange={(mode) => patchPrefs({ mode: mode as AiMode })}
          />
          <Select
            value={prefs.access}
            options={[
              { value: "confirm", label: "Confirm" },
              { value: "full", label: "Full access" },
            ]}
            onChange={(access) => patchPrefs({ access: access as AiAccess })}
          />
        </div>
        {prefs.mode === "agent" && prefs.access === "full" && (
          <p className="text-[11px] leading-relaxed" style={{ color: "#fca5a5" }}>
            Full access runs Agent commands without asking.
          </p>
        )}
        <Select
          value={prefs.providerId}
          options={AI_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            const next = getProvider(id as AiProviderId);
            setLiveModels(null);
            patchPrefs({
              providerId: id as AiProviderId,
              model: next.defaultModel || prefs.model,
            });
          }}
        />
        {regionOptions.length > 0 && (
          <Select
            value={prefs.region}
            options={regionOptions}
            onChange={(region) => patchPrefs({ region })}
          />
        )}
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <Select
              value={prefs.model}
              options={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(model) => patchPrefs({ model })}
            />
          </div>
          {provider.supportsModelList && (
            <button
              type="button"
              className="hover-subtle shrink-0 rounded-lg p-2"
              style={{ color: "var(--text-muted)" }}
              title="Refresh models"
              disabled={loadingModels}
              onClick={() => {
                setLoadingModels(true);
                void api
                  .aiListModels(prefs.providerId, derivedUrl)
                  .then((models) =>
                    setLiveModels(models.map((m) => ({ id: m.id, label: m.label || m.id }))),
                  )
                  .catch(() => undefined)
                  .finally(() => setLoadingModels(false));
              }}
            >
              {loadingModels ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          )}
        </div>
        {threads.length > 1 && (
          <Select
            value={threadId}
            options={threads.map((t) => ({
              value: t.id,
              label: t.title || "Chat",
            }))}
            onChange={loadThread}
          />
        )}
        <Checkbox
          label="Include terminal context"
          checked={prefs.includeTerminalContext}
          onChange={(checked) => patchPrefs({ includeTerminalContext: checked })}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-2 pt-6 text-center">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Terminal chat
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Ask about errors, drafts commands, or switch to Agent to run them.
              Keys live in Settings → AI.
            </p>
          </div>
        )}
        {messages.map((item) => (
          <div key={item.id} className="space-y-1.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {item.role === "user" ? "You" : "Azalea"}
            </div>
            {item.role === "user" ? (
              <div
                className="select-text rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{ background: "var(--bg-card)", color: "var(--text)" }}
              >
                {item.content}
              </div>
            ) : (
              <AiMarkdown
                text={item.content || (busy && item.id === streamingId ? "…" : "")}
                onInsertCommand={onInsertCommand}
                onRunCommand={onRunCommand}
                pendingApprove={item.id === messages[messages.length - 1]?.id ? pendingApprove : []}
                onApprove={(command) => {
                  onRunCommand(command);
                  setPendingApprove((prev) => prev.filter((c) => c !== command));
                }}
              />
            )}
          </div>
        ))}
        {error && (
          <p className="text-xs" style={{ color: "#f87171" }}>
            {error}
          </p>
        )}
      </div>

      <div className="border-t p-3" style={{ borderColor: "var(--border-subtle)" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={
            prefs.mode === "agent"
              ? "What should Agent do on this host?"
              : "Ask about this session…"
          }
          className="select-text w-full resize-none rounded-xl border px-3 py-2.5 text-[13px] outline-none"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border-subtle)",
            color: "var(--text)",
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {threads.length > 0 && (
            <button
              type="button"
              className="text-[11px]"
              style={{ color: "var(--text-muted)" }}
              onClick={() => {
                deleteAiThread(sessionId, threadId);
                startNewChat();
                setThreads(listAiThreads(sessionId));
              }}
            >
              Delete chat
            </button>
          )}
          <div className="ml-auto flex gap-1.5">
            {busy ? (
              <Button size="sm" variant="secondary" onClick={stop}>
                <Square size={12} />
                Stop
              </Button>
            ) : (
              <Button size="sm" disabled={!input.trim()} onClick={() => void send()}>
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
