import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUp,
  Brain,
  Clock,
  Loader2,
  Message,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  X,
} from "./icons";
import {
  AI_PROVIDERS,
  BEDROCK_MANTLE_REGIONS,
  BEDROCK_RUNTIME_REGIONS,
  addAiMemory,
  applyMemoryBlocksFromText,
  buildSystemPrompt,
  deleteAiMemory,
  deleteAiThread,
  formatHistoryCatalogForPrompt,
  formatMemoryForPrompt,
  formatRelatedChatsForPrompt,
  getAiMemory,
  getAiPrefs,
  getAiThread,
  getProvider,
  listAllAiThreads,
  newAiThreadId,
  parseSuggestedCommands,
  resolveProviderBaseUrl,
  saveAiThread,
  searchAiThreads,
  setAiPrefs,
  stripAnsi,
  threadPreview,
  type AiAccess,
  type AiChatMessageStored,
  type AiChatThread,
  type AiMemoryNote,
  type AiMode,
  type AiModelOption,
  type AiProviderId,
} from "../lib/ai";
import * as api from "../lib/api";
import { AiMarkdown } from "./AiMarkdown";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";

interface AiPanelProps {
  sessionId: string;
  hostLabel?: string;
  osId?: string | null;
  onInsertCommand: (command: string) => void;
  onRunCommand: (command: string) => void;
  onClose: () => void;
  getTerminalContext?: () => string;
}

type PanelView = "chat" | "history" | "memory";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

const WIDTH_KEY = "azalea.ai.panelWidth";
const MIN_WIDTH = 320;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 400;
const MAX_AGENT_STEPS = 8;

type StreamHandler = {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (text: string) => void;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForTerminalQuiet(
  getContext: (() => string) | undefined,
  beforeLen: number,
  shouldAbort: () => boolean,
  { quietMs = 900, maxMs = 18000, minWait = 450 }: { quietMs?: number; maxMs?: number; minWait?: number } = {},
): Promise<string> {
  if (!getContext) {
    await sleep(minWait);
    return "";
  }
  const start = Date.now();
  let lastLen = beforeLen;
  let lastChange = Date.now();
  await sleep(minWait);
  while (Date.now() - start < maxMs) {
    if (shouldAbort()) return getContext();
    const ctx = getContext();
    if (ctx.length !== lastLen) {
      lastLen = ctx.length;
      lastChange = Date.now();
    } else if (ctx.length > beforeLen && Date.now() - lastChange >= quietMs) {
      return ctx;
    }
    await sleep(180);
  }
  return getContext();
}

export function AiPanel({
  sessionId,
  hostLabel,
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
  const [threads, setThreads] = useState<AiChatThread[]>(() => listAllAiThreads());
  const [threadId, setThreadId] = useState<string>(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.id ?? all[0]?.id ?? newAiThreadId();
  });
  const [messages, setMessages] = useState<AiChatMessageStored[]>(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.messages ?? all[0]?.messages ?? [];
  });
  const [createdAt, setCreatedAt] = useState(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.createdAt ?? Date.now();
  });
  const [panelView, setPanelView] = useState<PanelView>("chat");
  const [historyQuery, setHistoryQuery] = useState("");
  const [memoryNotes, setMemoryNotes] = useState<AiMemoryNote[]>(() => getAiMemory());
  const [memoryDraft, setMemoryDraft] = useState("");
  const [pendingApprove, setPendingApprove] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<AiModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const streamHandlersRef = useRef<Map<string, StreamHandler>>(new Map());
  const messagesRef = useRef(messages);
  const prefsRef = useRef(prefs);
  const threadIdRef = useRef(threadId);
  const createdAtRef = useRef(createdAt);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const abortAgentRef = useRef(false);
  const approvedObsRef = useRef<string[]>([]);
  const hostLabelRef = useRef(hostLabel);
  const sessionIdRef = useRef(sessionId);

  messagesRef.current = messages;
  prefsRef.current = prefs;
  threadIdRef.current = threadId;
  createdAtRef.current = createdAt;
  hostLabelRef.current = hostLabel;
  sessionIdRef.current = sessionId;

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

  const modelLabel =
    modelOptions.find((m) => m.id === prefs.model)?.label ?? prefs.model;

  const historyThreads = useMemo(
    () => searchAiThreads(historyQuery),
    [historyQuery, threads],
  );

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

  const refreshThreads = () => setThreads(listAllAiThreads());
  const refreshMemory = () => setMemoryNotes(getAiMemory());

  const persist = (nextMessages: AiChatMessageStored[], id = threadIdRef.current) => {
    const firstUser = nextMessages.find(
      (m) => m.role === "user" && !m.content.startsWith("Command output:"),
    );
    const title = firstUser?.content.slice(0, 48) || "New chat";
    const thread: AiChatThread = {
      id,
      sessionId: sessionIdRef.current,
      hostLabel: hostLabelRef.current,
      title,
      messages: nextMessages,
      createdAt: createdAtRef.current,
      updatedAt: Date.now(),
    };
    saveAiThread(thread);
    refreshThreads();
  };

  useEffect(() => {
    setPendingApprove([]);
    setError(null);
    setAgentStatus(null);
    refreshThreads();
    refreshMemory();
  }, [sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, agentStatus, panelView]);

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
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<api.AiStreamEvent>("ai-stream", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      const handler = streamHandlersRef.current.get(payload.requestId);
      if (!handler) return;
      if (payload.kind === "delta" && payload.text) {
        handler.onDelta(payload.text);
      } else if (payload.kind === "error") {
        streamHandlersRef.current.delete(payload.requestId);
        handler.onError(payload.text || "Stream failed");
      } else if (payload.kind === "done") {
        streamHandlersRef.current.delete(payload.requestId);
        handler.onDone();
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [settingsOpen]);

  const startNewChat = () => {
    const id = newAiThreadId();
    const now = Date.now();
    setThreadId(id);
    setCreatedAt(now);
    setMessages([]);
    setPendingApprove([]);
    setError(null);
    setAgentStatus(null);
    setPanelView("chat");
  };

  const loadThread = (id: string) => {
    const thread = getAiThread(id);
    if (!thread) return;
    setThreadId(id);
    setCreatedAt(thread.createdAt || thread.updatedAt);
    setMessages(thread.messages);
    setPendingApprove([]);
    setError(null);
    setAgentStatus(null);
    setSettingsOpen(false);
    setPanelView("chat");
  };

  const removeThread = (id: string) => {
    deleteAiThread(id);
    refreshThreads();
    if (id === threadIdRef.current) startNewChat();
  };

  const stop = () => {
    abortAgentRef.current = true;
    if (requestIdRef.current) {
      void api.aiChatCancel(requestIdRef.current);
    }
    setBusy(false);
    setStreamingId(null);
    setAgentStatus(null);
    requestIdRef.current = null;
  };

  const appendAssistantDelta = (assistantId: string, text: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.id === assistantId) {
        next[next.length - 1] = { ...last, content: last.content + text };
      }
      return next;
    });
  };

  const streamTurn = async (
    assistantId: string,
    chatMessages: { role: string; content: string }[],
  ): Promise<string> => {
    const p = prefsRef.current;
    const prov = getProvider(p.providerId);
    const baseUrl = resolveProviderBaseUrl(p.providerId, p.region, p.customBaseUrl);
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    requestIdRef.current = requestId;
    setStreamingId(assistantId);

    let content = "";
    const done = new Promise<string>((resolve, reject) => {
      streamHandlersRef.current.set(requestId, {
        onDelta: (text) => {
          content += text;
          appendAssistantDelta(assistantId, text);
        },
        onDone: () => resolve(content),
        onError: (text) => reject(new Error(text)),
      });
    });

    try {
      await api.aiChatStream(requestId, {
        providerId: p.providerId,
        dialect: prov.dialect,
        baseUrl,
        model: p.model,
        messages: chatMessages,
      });
    } catch (err) {
      streamHandlersRef.current.delete(requestId);
      throw err;
    }

    return done;
  };

  const runCommandsObserving = async (commands: string[]): Promise<string> => {
    const chunks: string[] = [];
    for (let i = 0; i < commands.length; i++) {
      if (abortAgentRef.current) break;
      const command = commands[i];
      setAgentStatus(
        commands.length > 1
          ? `Running ${i + 1}/${commands.length}…`
          : "Running command…",
      );
      const before = getTerminalContext?.() ?? "";
      const beforeLen = before.length;
      onRunCommand(command);
      const after = await waitForTerminalQuiet(
        getTerminalContext,
        beforeLen,
        () => abortAgentRef.current,
      );
      const raw = after.slice(Math.max(0, beforeLen - 120));
      const cleaned = stripAnsi(raw).trim().slice(-4000);
      chunks.push(`$ ${command}\n${cleaned || "(no new output)"}`);
    }
    return chunks.join("\n\n");
  };

  const buildPayload = (
    history: AiChatMessageStored[],
    latestUser: string,
    extraSystem?: string,
  ) => {
    const p = prefsRef.current;
    const context =
      p.includeTerminalContext ? (getTerminalContext?.().trim() ?? "") : "";
    const mapped = history
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));

    const memoryBlock = formatMemoryForPrompt();
    const catalogBlock = formatHistoryCatalogForPrompt(threadIdRef.current);
    const relatedBlock = formatRelatedChatsForPrompt(latestUser, threadIdRef.current);

    return [
      { role: "system", content: buildSystemPrompt(p.mode, p.access, osId) },
      ...(memoryBlock
        ? [{ role: "system" as const, content: memoryBlock }]
        : []),
      ...(catalogBlock
        ? [{ role: "system" as const, content: catalogBlock }]
        : []),
      ...(relatedBlock
        ? [{ role: "system" as const, content: relatedBlock }]
        : []),
      ...(context
        ? [
            {
              role: "system" as const,
              content: `Recent terminal output (truncated):\n\`\`\`\n${stripAnsi(context).slice(-8000)}\n\`\`\``,
            },
          ]
        : []),
      ...(extraSystem
        ? [{ role: "system" as const, content: extraSystem }]
        : []),
      ...mapped.slice(0, -1),
      { role: "user", content: latestUser },
    ];
  };

  const harvestMemory = (assistantText: string) => {
    const { added, removed } = applyMemoryBlocksFromText(assistantText);
    if (added || removed) refreshMemory();
  };

  const continueAgentAfterOutput = async (
    working: AiChatMessageStored[],
    observation: string,
  ): Promise<"done" | "waiting"> => {
    const p = prefsRef.current;
    let history = [...working];
    let nextObservation = observation;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      if (abortAgentRef.current) return "done";

      const obsMsg: AiChatMessageStored = {
        id: `obs-${Date.now()}-${step}`,
        role: "user",
        content: `Command output:\n\`\`\`\n${nextObservation}\n\`\`\`\nContinue based on this output. If the task is done, summarize with no bash fences.`,
        createdAt: Date.now(),
      };
      const assistantId = `a-${Date.now()}-${step}`;
      const assistantMsg: AiChatMessageStored = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };
      history = [...history, obsMsg, assistantMsg];
      setMessages(history);
      persist(history);
      setAgentStatus(step === 0 ? "Reading output…" : `Agent step ${step + 1}…`);

      const payload = buildPayload(
        history,
        obsMsg.content,
        "You are continuing an Agent session. Prefer short steps.",
      );

      let content = "";
      try {
        content = await streamTurn(assistantId, payload);
      } catch (err) {
        setError(String(err));
        return "done";
      }

      harvestMemory(content);

      history = history.map((m) =>
        m.id === assistantId ? { ...m, content } : m,
      );
      setMessages(history);
      persist(history);

      const commands = parseSuggestedCommands(content);
      if (!commands.length) {
        setPendingApprove([]);
        return "done";
      }

      if (p.access === "confirm") {
        setPendingApprove(commands);
        setAgentStatus("Waiting for approval…");
        return "waiting";
      }

      nextObservation = await runCommandsObserving(commands);
      setPendingApprove([]);
    }
    return "done";
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setPendingApprove([]);
    abortAgentRef.current = false;
    approvedObsRef.current = [];

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
    let working = [...messagesRef.current, userMsg, assistantMsg];
    setMessages(working);
    setBusy(true);
    setAgentStatus(prefs.mode === "agent" ? "Thinking…" : null);
    persist(working);

    try {
      const payload = buildPayload(working, text);
      const content = await streamTurn(assistantId, payload);
      harvestMemory(content);
      working = working.map((m) =>
        m.id === assistantId ? { ...m, content } : m,
      );
      setMessages(working);
      persist(working);

      const p = prefsRef.current;
      if (p.mode !== "agent") {
        setPendingApprove([]);
        return;
      }

      const commands = parseSuggestedCommands(content);
      if (!commands.length) {
        setPendingApprove([]);
        return;
      }

      if (p.access === "confirm") {
        setPendingApprove(commands);
        setAgentStatus("Waiting for approval…");
        return;
      }

      const observation = await runCommandsObserving(commands);
      const result = await continueAgentAfterOutput(working, observation);
      if (result === "waiting") return;
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
    } finally {
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
      if (abortAgentRef.current || prefsRef.current.access !== "confirm") {
        setAgentStatus(null);
      }
    }
  };

  const approveCommand = async (command: string) => {
    const remaining = pendingApprove.filter((c) => c !== command);
    setPendingApprove(remaining);
    if (busy) return;

    abortAgentRef.current = false;
    setBusy(true);
    setError(null);

    try {
      const observation = await runCommandsObserving([command]);
      approvedObsRef.current.push(observation);
      if (remaining.length === 0) {
        const all = approvedObsRef.current.join("\n\n");
        approvedObsRef.current = [];
        const result = await continueAgentAfterOutput(messagesRef.current, all);
        if (result === "done") setAgentStatus(null);
      } else {
        setAgentStatus(`Approved · ${remaining.length} left`);
      }
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
    } finally {
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
          <Message size={16} style={{ color: "var(--text)" }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {panelView === "history" ? "Old chats" : panelView === "memory" ? "Memory" : "Chat"}
            </div>
            <div className="truncate text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {panelView === "history"
                ? "Saved on this PC only"
                : panelView === "memory"
                  ? `${memoryNotes.length} note${memoryNotes.length === 1 ? "" : "s"}`
                  : `${prefs.mode === "agent" ? "Agent" : "Ask"} · ${modelLabel}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="hover-subtle rounded-lg p-1.5"
            style={{
              color: panelView === "history" ? "var(--text)" : "var(--text-muted)",
              background: panelView === "history" ? "var(--bg-card)" : "transparent",
            }}
            title="Old chats"
            onClick={() => {
              refreshThreads();
              setPanelView((v) => (v === "history" ? "chat" : "history"));
              setSettingsOpen(false);
            }}
          >
            <Clock size={15} />
          </button>
          <button
            type="button"
            className="hover-subtle rounded-lg p-1.5"
            style={{
              color: panelView === "memory" ? "var(--text)" : "var(--text-muted)",
              background: panelView === "memory" ? "var(--bg-card)" : "transparent",
            }}
            title="Memory"
            onClick={() => {
              refreshMemory();
              setPanelView((v) => (v === "memory" ? "chat" : "memory"));
              setSettingsOpen(false);
            }}
          >
            <Brain size={15} />
          </button>
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

      {panelView === "history" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search old chats…"
              className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {historyThreads.length === 0 ? (
              <p className="px-2 pt-6 text-center text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {historyQuery.trim() ? "No chats match." : "No saved chats yet. They stay on this PC only."}
              </p>
            ) : (
              historyThreads.map((t) => {
                const active = t.id === threadId;
                return (
                  <div
                    key={t.id}
                    className="group flex items-start gap-1 rounded-xl px-2 py-2"
                    style={{
                      background: active ? "var(--bg-card)" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => loadThread(t.id)}
                    >
                      <div className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                        {t.title || "Chat"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {formatRelativeTime(t.updatedAt)}
                        {t.hostLabel ? ` · ${t.hostLabel}` : ""}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                        {threadPreview(t, 120)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="hover-subtle shrink-0 rounded-lg p-1.5 opacity-60 hover:opacity-100"
                      style={{ color: "var(--text-muted)" }}
                      title="Delete chat"
                      onClick={() => removeThread(t.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : panelView === "memory" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Local notes the AI can reuse across chats. Also saved when the model writes a{" "}
              <code className="text-[11px]">```memory</code> block.
            </p>
            <div className="flex gap-2">
              <input
                value={memoryDraft}
                onChange={(e) => setMemoryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!memoryDraft.trim()) return;
                    addAiMemory(memoryDraft, "user");
                    setMemoryDraft("");
                    refreshMemory();
                  }
                }}
                placeholder="Add a note…"
                className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-[13px] outline-none"
                style={{
                  background: "var(--bg-input)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text)",
                }}
              />
              <button
                type="button"
                className="hover-subtle shrink-0 rounded-xl px-3 py-2 text-[12px] font-medium"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text)",
                  border: "1px solid var(--border-subtle)",
                }}
                onClick={() => {
                  if (!memoryDraft.trim()) return;
                  addAiMemory(memoryDraft, "user");
                  setMemoryDraft("");
                  refreshMemory();
                }}
              >
                Add
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
            {memoryNotes.length === 0 ? (
              <p className="px-2 pt-6 text-center text-[13px]" style={{ color: "var(--text-secondary)" }}>
                Empty. Add notes here or let Agent save useful facts.
              </p>
            ) : (
              memoryNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start gap-2 rounded-xl border px-3 py-2.5"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="select-text text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
                      {note.text}
                    </div>
                    <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {note.source === "ai" ? "AI" : "You"} · {formatRelativeTime(note.updatedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="hover-subtle shrink-0 rounded-lg p-1.5"
                    style={{ color: "var(--text-muted)" }}
                    title="Forget"
                    onClick={() => {
                      deleteAiMemory(note.id);
                      refreshMemory();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
      <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3.5 py-4">
        {messages.length === 0 && (
          <div className="space-y-2 pt-8 text-center">
            <div className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              Terminal chat
            </div>
            <p className="mx-auto max-w-[260px] text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Ask about errors, draft commands, or switch to Agent to run them and read the output.
            </p>
          </div>
        )}
        {messages.map((item) => {
          const isObs = item.role === "user" && item.content.startsWith("Command output:");
          return (
            <div key={item.id} className="space-y-1.5">
              <div
                className="text-[11px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                {item.role === "user" ? (isObs ? "Terminal" : "You") : "Azalea"}
              </div>
              {item.role === "user" ? (
                <div
                  className="select-text rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap"
                  style={{
                    background: isObs ? "var(--bg-card)" : "var(--bg-card-hover)",
                    color: "var(--text)",
                    border: isObs ? "1px solid var(--border-subtle)" : undefined,
                  }}
                >
                  {isObs ? (
                    <AiMarkdown text={item.content} />
                  ) : (
                    item.content
                  )}
                </div>
              ) : (
                <AiMarkdown
                  text={item.content || (busy && item.id === streamingId ? "…" : "")}
                  onInsertCommand={prefs.mode === "ask" ? onInsertCommand : undefined}
                  onRunCommand={prefs.mode === "ask" ? onRunCommand : undefined}
                  pendingApprove={
                    item.id === messages[messages.length - 1]?.id ? pendingApprove : []
                  }
                  onApprove={(command) => void approveCommand(command)}
                />
              )}
            </div>
          );
        })}
        {agentStatus && (
          <p className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {agentStatus}
          </p>
        )}
        {error && (
          <p className="text-[13px]" style={{ color: "#f87171" }}>
            {error}
          </p>
        )}
      </div>
      )}

      {panelView === "chat" && (
      <div
        ref={composerRef}
        className="border-t p-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div
          className="rounded-2xl border"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border-subtle)",
          }}
        >
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
                ? "Tell Agent what to do…"
                : "Ask about this session…"
            }
            className="select-text w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[14px] leading-relaxed outline-none"
            style={{ color: "var(--text)" }}
          />

          <div className="flex items-center gap-1.5 px-2 pb-2">
            <Select
              size="sm"
              menuPlacement="top"
              className="w-[104px] shrink-0"
              value={prefs.mode}
              options={[
                { value: "ask", label: "Ask" },
                { value: "agent", label: "Agent" },
              ]}
              onChange={(mode) => {
                setSettingsOpen(false);
                patchPrefs({ mode: mode as AiMode });
              }}
            />
            <Select
              size="sm"
              menuPlacement="top"
              className="min-w-0 max-w-[160px] flex-1"
              value={prefs.model}
              options={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(model) => {
                setSettingsOpen(false);
                patchPrefs({ model });
              }}
            />

            <div className="relative ml-auto flex items-center gap-1">
              <button
                type="button"
                className="hover-subtle rounded-lg p-1.5"
                style={{ color: "var(--text-muted)" }}
                title="Chat settings"
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <Settings size={15} />
              </button>
              {settingsOpen && (
                <div
                  className="absolute bottom-full right-0 z-20 mb-1 w-[280px] space-y-3 rounded-xl border p-3 shadow-lg"
                  style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <Select
                    label="Provider"
                    value={prefs.providerId}
                    menuPlacement="top"
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
                      label="Region"
                      value={prefs.region}
                      menuPlacement="top"
                      options={regionOptions}
                      onChange={(region) => patchPrefs({ region })}
                    />
                  )}
                  {prefs.mode === "agent" && (
                    <div className="space-y-1.5">
                      <Select
                        label="Access"
                        value={prefs.access}
                        menuPlacement="top"
                        options={[
                          { value: "confirm", label: "Confirm each command" },
                          { value: "full", label: "Full access" },
                        ]}
                        onChange={(access) => patchPrefs({ access: access as AiAccess })}
                      />
                      {prefs.access === "full" && (
                        <p className="text-[11px] leading-relaxed" style={{ color: "#fca5a5" }}>
                          Full access runs commands without asking.
                        </p>
                      )}
                    </div>
                  )}
                  <Checkbox
                    label="Include terminal context"
                    checked={prefs.includeTerminalContext}
                    onChange={(checked) => patchPrefs({ includeTerminalContext: checked })}
                  />
                  {provider.supportsModelList && (
                    <button
                      type="button"
                      className="hover-subtle flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
                      style={{ color: "var(--text-secondary)" }}
                      disabled={loadingModels}
                      onClick={() => {
                        setLoadingModels(true);
                        void api
                          .aiListModels(prefs.providerId, derivedUrl)
                          .then((models) =>
                            setLiveModels(
                              models.map((m) => ({ id: m.id, label: m.label || m.id })),
                            ),
                          )
                          .catch(() => undefined)
                          .finally(() => setLoadingModels(false));
                      }}
                    >
                      {loadingModels ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      Refresh models
                    </button>
                  )}
                  {threads.some((t) => t.id === threadId) && (
                    <button
                      type="button"
                      className="text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => {
                        removeThread(threadId);
                        setSettingsOpen(false);
                      }}
                    >
                      Delete this chat
                    </button>
                  )}
                </div>
              )}

              {busy ? (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: "var(--bg-card)", color: "var(--text)" }}
                  title="Stop"
                  onClick={stop}
                >
                  <Square size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
                  style={{
                    background: input.trim() ? "var(--text)" : "var(--bg-card)",
                    color: input.trim() ? "var(--bg-panel)" : "var(--text-muted)",
                  }}
                  disabled={!input.trim()}
                  title="Send"
                  onClick={() => void send()}
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </aside>
  );
}
