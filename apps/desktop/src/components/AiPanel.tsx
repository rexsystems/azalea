import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUp,
  Brain,
  Clock,
  Download,
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
  exportAiThreadsJson,
  formatHistoryCatalogForPrompt,
  formatMemoryForPrompt,
  formatRelatedChatsForPrompt,
  getAiMemory,
  getAiPrefs,
  getAiThread,
  getProvider,
  listAllAiThreads,
  newAiThreadId,
  parseSuggestedActions,
  pendingActionsEqual,
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
  type AiPendingAction,
  type AiProviderId,
} from "../lib/ai";
import * as api from "../lib/api";
import { runAiCommand } from "../lib/aiCommand";
import { useAiModels } from "../hooks/useAiModels";
import { AiMarkdown } from "./AiMarkdown";
import { AiActivity } from "./AiActivity";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";

interface AiPanelProps {
  sessionId: string;
  hostLabel?: string;
  osId?: string | null;
  onInsertCommand: (command: string) => void;
  onRunCommand: (command: string) => void;
  onWriteFile?: (path: string, contents: string) => Promise<void>;
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

export function AiPanel({
  sessionId,
  hostLabel,
  osId,
  onInsertCommand,
  onRunCommand,
  onWriteFile,
  onClose,
  getTerminalContext,
}: AiPanelProps) {
  const [prefs, setPrefsState] = useState(() => getAiPrefs());
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored)
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored))
      : DEFAULT_WIDTH;
  });
  const [threads, setThreads] = useState<AiChatThread[]>(() =>
    listAllAiThreads(),
  );
  const [threadId, setThreadId] = useState<string>(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.id ?? newAiThreadId();
  });
  const [messages, setMessages] = useState<AiChatMessageStored[]>(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.messages ?? [];
  });
  const [createdAt, setCreatedAt] = useState(() => {
    const all = listAllAiThreads();
    const forSession = all.find((t) => t.sessionId === sessionId);
    return forSession?.createdAt ?? Date.now();
  });
  const [panelView, setPanelView] = useState<PanelView>("chat");
  const [historyQuery, setHistoryQuery] = useState("");
  const [memoryNotes, setMemoryNotes] = useState<AiMemoryNote[]>(() =>
    getAiMemory(),
  );
  const [memoryDraft, setMemoryDraft] = useState("");
  const [pendingApprove, setPendingApprove] = useState<AiPendingAction[]>([]);
  const [snippetStatus, setSnippetStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const prefsRef = useRef(prefs);
  const threadIdRef = useRef(threadId);
  const createdAtRef = useRef(createdAt);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const abortAgentRef = useRef(false);
  const commandAbortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(false);
  const [commandOutput, setCommandOutput] = useState<string | null>(null);
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
  const {
    models: modelOptions,
    loading: loadingModels,
    error: modelsError,
    refresh: refreshModels,
  } = useAiModels(prefs);

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

  const persist = (
    nextMessages: AiChatMessageStored[],
    id = threadIdRef.current,
  ) => {
    const firstUser = nextMessages.find(
      (m) =>
        m.role === "user" &&
        !m.content.startsWith("Command output:") &&
        !m.content.startsWith("Action results:"),
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
    const syncPrefs = () => setPrefsState(getAiPrefs());
    window.addEventListener("azalea-ai-prefs", syncPrefs);
    return () => {
      window.removeEventListener("azalea-ai-prefs", syncPrefs);
      abortAgentRef.current = true;
      commandAbortRef.current?.abort();
      if (requestIdRef.current) void api.aiChatCancel(requestIdRef.current);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, agentStatus, commandOutput, panelView]);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => {
      if (
        composerRef.current &&
        !composerRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [settingsOpen]);

  const startNewChat = () => {
    if (operationRef.current) return;
    const id = newAiThreadId();
    const now = Date.now();
    setThreadId(id);
    setCreatedAt(now);
    setMessages([]);
    setCommandOutput(null);
    setPendingApprove([]);
    setError(null);
    setAgentStatus(null);
    setPanelView("chat");
  };

  const loadThread = (id: string) => {
    if (operationRef.current) return;
    const thread = getAiThread(id);
    if (!thread) return;
    setThreadId(id);
    setCreatedAt(thread.createdAt || thread.updatedAt);
    setMessages(thread.messages);
    setCommandOutput(null);
    setPendingApprove([]);
    setError(null);
    setAgentStatus(null);
    setSettingsOpen(false);
    setPanelView("chat");
  };

  const removeThread = (id: string) => {
    if (operationRef.current && id === threadIdRef.current) return;
    deleteAiThread(id);
    refreshThreads();
    if (id === threadIdRef.current) startNewChat();
  };

  const stop = () => {
    abortAgentRef.current = true;
    commandAbortRef.current?.abort();
    if (requestIdRef.current) {
      void api.aiChatCancel(requestIdRef.current);
    }
    setPendingApprove([]);
    setAgentStatus(operationRef.current ? "Stopping…" : null);
  };

  const streamTurn = async (
    assistantId: string,
    chatMessages: { role: string; content: string }[],
  ): Promise<string> => {
    const p = prefsRef.current;
    const prov = getProvider(p.providerId);
    const baseUrl = resolveProviderBaseUrl(
      p.providerId,
      p.region,
      p.customBaseUrl,
    );
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    requestIdRef.current = requestId;
    setStreamingId(assistantId);

    let content = "";
    try {
      await new Promise<void>((resolve, reject) => {
        void api
          .aiChatStream(
            requestId,
            {
              providerId: p.providerId,
              dialect: prov.dialect,
              baseUrl,
              model: p.model,
              messages: chatMessages,
            },
            {
              onDelta: (text) => {
                if (!content) setAgentStatus("Working…");
                content += text;
                const snapshot = content;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant" && last.id === assistantId) {
                    next[next.length - 1] = { ...last, content: snapshot };
                  }
                  return next;
                });
              },
              onDone: () => resolve(),
              onError: (text) => reject(new Error(text)),
            },
          )
          .catch((err) =>
            reject(err instanceof Error ? err : new Error(String(err))),
          );
      });
    } finally {
      const next = messagesRef.current.map((message) =>
        message.id === assistantId ? { ...message, content } : message,
      );
      messagesRef.current = next;
      setMessages(next);
      persist(next);
    }
    return content;
  };

  const runActionsObserving = async (
    actions: AiPendingAction[],
  ): Promise<string> => {
    const chunks: string[] = [];
    for (let i = 0; i < actions.length; i++) {
      if (abortAgentRef.current) break;
      const action = actions[i];
      setAgentStatus(
        actions.length > 1
          ? `Running ${i + 1}/${actions.length}…`
          : action.type === "write"
            ? "Writing file…"
            : "Running command…",
      );

      if (action.type === "shell") {
        const controller = new AbortController();
        commandAbortRef.current = controller;
        setCommandOutput(`$ ${action.command}\n`);
        try {
          const powershell =
            /windows/i.test(osId ?? "") ||
            (api.isLocalSession(sessionId) && /Win/i.test(navigator.platform));
          const result = await runAiCommand(
            sessionId,
            action.command,
            controller.signal,
            (output) => {
              setCommandOutput(`$ ${action.command}\n${stripAnsi(output)}`);
            },
            powershell,
          );
          const cleaned = stripAnsi(result.output).trim();
          const observation = `$ ${action.command}\n${cleaned || "(no output)"}\nExit code: ${result.exitCode}`;
          setCommandOutput(observation);
          chunks.push(observation);
        } finally {
          commandAbortRef.current = null;
        }
        continue;
      }

      try {
        if (!onWriteFile) {
          chunks.push(
            `write ${action.path}\nError: File write needs an SSH session.`,
          );
          continue;
        }
        await onWriteFile(action.path, action.content);
        const bytes = new TextEncoder().encode(action.content).length;
        chunks.push(`write ${action.path}\nWrote ${bytes} bytes.`);
      } catch (err) {
        chunks.push(`write ${action.path}\nError: ${String(err)}`);
      }
    }
    return chunks.join("\n\n");
  };

  const buildPayload = (
    history: AiChatMessageStored[],
    latestUser: string,
    extraSystem?: string,
  ) => {
    const p = prefsRef.current;
    const context = p.includeTerminalContext
      ? (getTerminalContext?.().trim() ?? "")
      : "";
    const mapped = history
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));

    const memoryBlock = formatMemoryForPrompt();
    const catalogBlock = formatHistoryCatalogForPrompt(threadIdRef.current);
    const relatedBlock = formatRelatedChatsForPrompt(
      latestUser,
      threadIdRef.current,
    );

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
    let history = [...working];
    let nextObservation = observation;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      if (abortAgentRef.current) return "done";

      const obsMsg: AiChatMessageStored = {
        id: `obs-${Date.now()}-${step}`,
        role: "user",
        content: `Action results:\n\`\`\`\n${nextObservation}\n\`\`\`\nContinue based on this. If the task is done, summarize with no bash/write fences.`,
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
      setAgentStatus(step === 0 ? "Reading output…" : "Planning next moves…");

      const payload = buildPayload(
        history,
        obsMsg.content,
        "You are continuing an Agent session. Prefer short steps.",
      );

      let content = "";
      try {
        content = await streamTurn(assistantId, payload);
      } catch (err) {
        if (!abortAgentRef.current) setError(String(err));
        return "done";
      }

      if (abortAgentRef.current) return "done";
      harvestMemory(content);

      history = history.map((m) =>
        m.id === assistantId ? { ...m, content } : m,
      );
      setMessages(history);
      persist(history);

      const actions = parseSuggestedActions(content);
      if (abortAgentRef.current) return "done";
      if (!actions.length) {
        setPendingApprove([]);
        return "done";
      }

      if (prefsRef.current.access === "confirm") {
        setPendingApprove(actions);
        setAgentStatus("Waiting for approval…");
        return "waiting";
      }

      nextObservation = await runActionsObserving(actions);
      setPendingApprove([]);
    }
    setError(
      `Agent paused after ${MAX_AGENT_STEPS} steps. Review the results before continuing.`,
    );
    return "done";
  };

  const send = async () => {
    const text = input.trim();
    if (!text || operationRef.current) return;
    operationRef.current = true;
    setInput("");
    setError(null);
    setPendingApprove([]);
    setCommandOutput(null);
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
    setAgentStatus("Thinking…");
    persist(working);
    let keepAgentStatus = false;

    try {
      const payload = buildPayload(working, text);
      const content = await streamTurn(assistantId, payload);
      if (abortAgentRef.current) return;
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

      const actions = parseSuggestedActions(content);
      if (!actions.length) {
        setPendingApprove([]);
        return;
      }

      if (p.access === "confirm") {
        setPendingApprove(actions);
        setAgentStatus("Waiting for approval…");
        keepAgentStatus = true;
        return;
      }

      const observation = await runActionsObserving(actions);
      const result = await continueAgentAfterOutput(working, observation);
      if (result === "waiting") {
        keepAgentStatus = true;
        return;
      }
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
    } finally {
      operationRef.current = false;
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
      if (!keepAgentStatus) setAgentStatus(null);
    }
  };

  const approveAction = async (action: AiPendingAction) => {
    if (
      operationRef.current ||
      !pendingApprove.some((a) => pendingActionsEqual(a, action))
    )
      return;
    operationRef.current = true;
    const index = pendingApprove.findIndex((a) =>
      pendingActionsEqual(a, action),
    );
    if (index !== 0) {
      operationRef.current = false;
      return;
    }
    const remaining = pendingApprove.filter((_, i) => i !== index);
    setPendingApprove(remaining);

    abortAgentRef.current = false;
    setBusy(true);
    setError(null);

    try {
      const observation = await runActionsObserving([action]);
      approvedObsRef.current.push(observation);
      if (remaining.length === 0) {
        const all = approvedObsRef.current.join("\n\n");
        approvedObsRef.current = [];
        const result = await continueAgentAfterOutput(messagesRef.current, all);
        if (result === "done") setAgentStatus(null);
      } else {
        setAgentStatus(`Waiting for approval · ${remaining.length} remaining`);
      }
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
      setAgentStatus(
        remaining.length
          ? `Waiting for approval · ${remaining.length} remaining`
          : null,
      );
    } finally {
      operationRef.current = false;
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
      if (abortAgentRef.current) setAgentStatus(null);
    }
  };

  const approveAll = async () => {
    if (!pendingApprove.length || operationRef.current) return;
    operationRef.current = true;
    const actions = [...pendingApprove];
    setPendingApprove([]);
    abortAgentRef.current = false;
    setBusy(true);
    setError(null);
    try {
      const prior = approvedObsRef.current.join("\n\n");
      approvedObsRef.current = [];
      const observation = await runActionsObserving(actions);
      const combined = [prior, observation].filter(Boolean).join("\n\n");
      const result = await continueAgentAfterOutput(
        messagesRef.current,
        combined,
      );
      if (result === "done") setAgentStatus(null);
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
    } finally {
      operationRef.current = false;
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
      if (abortAgentRef.current) setAgentStatus(null);
    }
  };

  const rejectAll = async () => {
    if (!pendingApprove.length || operationRef.current) return;
    operationRef.current = true;
    setPendingApprove([]);
    approvedObsRef.current = [];
    abortAgentRef.current = false;
    setBusy(true);
    setError(null);
    try {
      const result = await continueAgentAfterOutput(
        messagesRef.current,
        "User rejected the proposed actions. Propose a safer alternative or ask what to do next. Do not repeat the same actions.",
      );
      if (result === "done") setAgentStatus(null);
    } catch (err) {
      if (!abortAgentRef.current) setError(String(err));
    } finally {
      operationRef.current = false;
      setBusy(false);
      setStreamingId(null);
      requestIdRef.current = null;
      if (abortAgentRef.current) setAgentStatus(null);
    }
  };

  const exportThread = async (thread: AiChatThread | null, all = false) => {
    const list = all ? listAllAiThreads() : thread ? [thread] : [];
    if (!list.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = (thread?.title || "chat")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
    const name = all
      ? `azalea-chats-${stamp}.json`
      : `azalea-chat-${safe || "chat"}-${stamp}.json`;
    try {
      await api.saveTextFile(
        name,
        [{ name: "JSON", extensions: ["json"] }],
        exportAiThreadsJson(list),
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const saveSnippetFromChat = async (command: string) => {
    const first =
      command
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ?? "Snippet";
    const name = first.slice(0, 48) || "Snippet from chat";
    try {
      await api.createSnippet({ name, command });
      setSnippetStatus("Snippet saved");
      window.setTimeout(() => setSnippetStatus(null), 2000);
    } catch (err) {
      setError(String(err));
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
    const next = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, dragRef.current.startW + delta),
    );
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
            <div
              className="text-sm font-semibold"
              style={{ color: "var(--text)" }}
            >
              {panelView === "history"
                ? "Old chats"
                : panelView === "memory"
                  ? "Memory"
                  : "Chat"}
            </div>
            <div
              className="truncate text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
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
              color:
                panelView === "history" ? "var(--text)" : "var(--text-muted)",
              background:
                panelView === "history" ? "var(--bg-card)" : "transparent",
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
              color:
                panelView === "memory" ? "var(--text)" : "var(--text-muted)",
              background:
                panelView === "memory" ? "var(--bg-card)" : "transparent",
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
          <div
            className="border-b px-3 py-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
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
            {threads.length > 0 && (
              <button
                type="button"
                className="mt-2 text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => void exportThread(null, true)}
              >
                Export all chats
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {historyThreads.length === 0 ? (
              <p
                className="px-2 pt-6 text-center text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {historyQuery.trim()
                  ? "No chats match."
                  : "No saved chats yet. They stay on this PC only."}
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
                      <div
                        className="truncate text-[13px] font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {t.title || "Chat"}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {formatRelativeTime(t.updatedAt)}
                        {t.hostLabel ? ` · ${t.hostLabel}` : ""}
                      </div>
                      <div
                        className="mt-1 line-clamp-2 text-[12px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {threadPreview(t, 120)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="hover-subtle shrink-0 rounded-lg p-1.5 opacity-60 hover:opacity-100"
                      style={{ color: "var(--text-muted)" }}
                      title="Export chat"
                      onClick={() => void exportThread(t)}
                    >
                      <Download size={14} />
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
          <div
            className="space-y-2 border-b px-3 py-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Local notes the AI can reuse across chats. Also saved when the
              model writes a <code className="text-[11px]">```memory</code>{" "}
              block.
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
              <p
                className="px-2 pt-6 text-center text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Empty. Add notes here or let Agent save useful facts.
              </p>
            ) : (
              memoryNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start gap-2 rounded-xl border px-3 py-2.5"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--bg-card)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="select-text text-[13px] leading-relaxed"
                      style={{ color: "var(--text)" }}
                    >
                      {note.text}
                    </div>
                    <div
                      className="mt-1 text-[10px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {note.source === "ai" ? "AI" : "You"} ·{" "}
                      {formatRelativeTime(note.updatedAt)}
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
        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3.5 py-4"
        >
          {messages.length === 0 && (
            <div className="space-y-2 pt-8 text-center">
              <div
                className="text-[15px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Terminal chat
              </div>
              <p
                className="mx-auto max-w-[260px] text-[13px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Ask about errors, draft commands, or switch to Agent to run them
                and read the output.
              </p>
            </div>
          )}
          {messages.map((item) => {
            const isObs =
              item.role === "user" &&
              (item.content.startsWith("Command output:") ||
                item.content.startsWith("Action results:"));
            return (
              <div
                key={item.id}
                className="space-y-2.5"
                aria-busy={busy && item.id === streamingId}
              >
                <div
                  className="text-[11px] font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.role === "user"
                    ? isObs
                      ? "Terminal"
                      : "You"
                    : "Azalea"}
                </div>
                {item.role === "user" ? (
                  <div
                    className="select-text rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap"
                    style={{
                      background: isObs
                        ? "var(--bg-card)"
                        : "var(--bg-card-hover)",
                      color: "var(--text)",
                      border: isObs
                        ? "1px solid var(--border-subtle)"
                        : undefined,
                    }}
                  >
                    {isObs ? <AiMarkdown text={item.content} /> : item.content}
                  </div>
                ) : !item.content && busy && item.id === streamingId ? (
                  <AiActivity text={agentStatus ?? "Thinking…"} active />
                ) : (
                  <AiMarkdown
                    text={item.content}
                    onInsertCommand={
                      prefs.mode === "ask" ? onInsertCommand : undefined
                    }
                    onRunCommand={
                      prefs.mode === "ask" ? onRunCommand : undefined
                    }
                    onWriteFile={
                      prefs.mode === "ask" && onWriteFile
                        ? (path, content) => {
                            void onWriteFile(path, content).catch((err) =>
                              setError(String(err)),
                            );
                          }
                        : undefined
                    }
                    onSaveSnippet={(command) =>
                      void saveSnippetFromChat(command)
                    }
                    pendingApprove={
                      item.id === messages[messages.length - 1]?.id
                        ? pendingApprove
                        : []
                    }
                    onApprove={(action) => void approveAction(action)}
                    disabled={busy}
                  />
                )}
              </div>
            );
          })}
          {pendingApprove.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-card)",
              }}
            >
              <span
                className="text-[12px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Waiting for approval · {pendingApprove.length} pending
              </span>
              <Button
                size="xs"
                disabled={busy}
                onClick={() => void approveAll()}
              >
                Approve all
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => void rejectAll()}
              >
                Reject all
              </Button>
            </div>
          )}
          {agentStatus &&
            (busy || pendingApprove.length === 0) &&
            !messages.some(
              (m) => busy && m.id === streamingId && !m.content,
            ) && (
              <AiActivity
                text={agentStatus}
                active={busy && agentStatus !== "Stopping…"}
              />
            )}
          {commandOutput !== null && (
            <pre
              className="select-text max-h-64 overflow-auto rounded-xl border px-3 py-2 font-mono text-[12px] whitespace-pre-wrap"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-card)",
                color: "var(--text-secondary)",
              }}
            >
              {commandOutput}
            </pre>
          )}
          {snippetStatus && (
            <p
              className="text-[12px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {snippetStatus}
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
                disabled={busy}
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
                disabled={busy}
                placeholder="Select model"
                options={modelOptions.map((m) => ({
                  value: m.id,
                  label: m.label,
                }))}
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
                    style={{
                      background: "var(--bg-panel)",
                      borderColor: "var(--border-subtle)",
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <Select
                      label="Provider"
                      disabled={busy}
                      value={prefs.providerId}
                      menuPlacement="top"
                      options={AI_PROVIDERS.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      onChange={(id) => {
                        patchPrefs({
                          providerId: id as AiProviderId,
                        });
                      }}
                    />
                    {regionOptions.length > 0 && (
                      <Select
                        label="Region"
                        disabled={busy}
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
                          disabled={busy}
                          value={prefs.access}
                          menuPlacement="top"
                          options={[
                            { value: "confirm", label: "Confirm each command" },
                            { value: "full", label: "Full access" },
                          ]}
                          onChange={(access) =>
                            patchPrefs({ access: access as AiAccess })
                          }
                        />
                        {prefs.access === "full" && (
                          <p
                            className="text-[11px] leading-relaxed"
                            style={{ color: "#fca5a5" }}
                          >
                            Full access runs commands and file writes without
                            asking.
                          </p>
                        )}
                      </div>
                    )}
                    <Checkbox
                      label="Include terminal context"
                      checked={prefs.includeTerminalContext}
                      onChange={(checked) =>
                        patchPrefs({ includeTerminalContext: checked })
                      }
                    />
                    <button
                      type="button"
                      className="hover-subtle flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
                      style={{ color: "var(--text-secondary)" }}
                      onClick={() => {
                        const current = getAiThread(threadId);
                        void exportThread(current);
                        setSettingsOpen(false);
                      }}
                    >
                      <Download size={13} />
                      Export this chat
                    </button>
                    <button
                      type="button"
                      className="hover-subtle flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
                      style={{ color: "var(--text-secondary)" }}
                      onClick={() => {
                        void exportThread(null, true);
                        setSettingsOpen(false);
                      }}
                    >
                      <Download size={13} />
                      Export all chats
                    </button>
                    {provider.supportsModelList && (
                      <button
                        type="button"
                        className="hover-subtle flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
                        style={{ color: "var(--text-secondary)" }}
                        disabled={loadingModels}
                        onClick={refreshModels}
                      >
                        {loadingModels ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                        Refresh models
                      </button>
                    )}
                    {modelsError && (
                      <p
                        className="text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {modelsError}
                      </p>
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
                    style={{
                      background: "var(--bg-card)",
                      color: "var(--text)",
                    }}
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
                      background: input.trim()
                        ? "var(--text)"
                        : "var(--bg-card)",
                      color: input.trim()
                        ? "var(--bg-panel)"
                        : "var(--text-muted)",
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
