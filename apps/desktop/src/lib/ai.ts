/** Opt-in terminal AI (BYOK). Off until the user accepts the first-run prompt. */

export type AiMode = "ask" | "agent";
export type AiAccess = "confirm" | "full";
export type AiDialect = "openai" | "anthropic";

export type AiProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "ollama"
  | "amazon_bedrock"
  | "amazon_bedrock_mantle"
  | "custom_openai"
  | "custom_anthropic";

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiProviderDef {
  id: AiProviderId;
  name: string;
  description: string;
  dialect: AiDialect;
  /** Fixed base URL, or null when derived from region / custom. */
  baseUrl: string | null;
  needsRegion: boolean;
  regionKind: "none" | "bedrock_runtime" | "bedrock_mantle";
  allowCustomUrl: boolean;
  defaultModel: string;
  models: AiModelOption[];
  /** Try GET /models when a key is present. */
  supportsModelList: boolean;
}

export const BEDROCK_RUNTIME_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
  "us-gov-west-1",
  "us-gov-east-1",
] as const;

export const BEDROCK_MANTLE_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-northeast-1",
  "ap-south-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-north-1",
  "sa-east-1",
  "us-gov-west-1",
] as const;

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "Official OpenAI API.",
    dialect: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: false,
    defaultModel: "gpt-5-mini",
    supportsModelList: true,
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude via Anthropic Messages API.",
    dialect: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: false,
    defaultModel: "claude-sonnet-4-6",
    supportsModelList: true,
    models: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek OpenAI-compatible API.",
    dialect: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: false,
    defaultModel: "deepseek-chat",
    supportsModelList: true,
    models: [],
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast OpenAI-compatible inference.",
    dialect: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: false,
    defaultModel: "llama-3.3-70b-versatile",
    supportsModelList: true,
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Multi-model OpenAI-compatible gateway.",
    dialect: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: false,
    defaultModel: "anthropic/claude-sonnet-4.5",
    supportsModelList: true,
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Local OpenAI-compatible server.",
    dialect: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: true,
    defaultModel: "",
    supportsModelList: true,
    models: [],
  },
  {
    id: "amazon_bedrock",
    name: "Amazon Bedrock",
    description:
      "Bedrock Runtime OpenAI-compatible endpoint. Paste a Bedrock API key.",
    dialect: "openai",
    baseUrl: null,
    needsRegion: true,
    regionKind: "bedrock_runtime",
    allowCustomUrl: false,
    defaultModel: "openai.gpt-oss-120b-1:0",
    supportsModelList: false,
    models: [
      { id: "openai.gpt-oss-120b-1:0", label: "GPT-OSS 120B" },
      { id: "openai.gpt-oss-20b-1:0", label: "GPT-OSS 20B" },
    ],
  },
  {
    id: "amazon_bedrock_mantle",
    name: "Amazon Bedrock Mantle",
    description:
      "Bedrock Mantle endpoint (bedrock-mantle.{region}.api.aws). Separate from Runtime.",
    dialect: "openai",
    baseUrl: null,
    needsRegion: true,
    regionKind: "bedrock_mantle",
    allowCustomUrl: false,
    defaultModel: "openai.gpt-oss-120b",
    supportsModelList: true,
    models: [],
  },
  {
    id: "custom_openai",
    name: "Custom (OpenAI-compatible)",
    description: "Any OpenAI chat-completions compatible base URL.",
    dialect: "openai",
    baseUrl: null,
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: true,
    defaultModel: "",
    supportsModelList: true,
    models: [],
  },
  {
    id: "custom_anthropic",
    name: "Custom (Anthropic-compatible)",
    description: "Any Anthropic Messages-compatible base URL.",
    dialect: "anthropic",
    baseUrl: null,
    needsRegion: false,
    regionKind: "none",
    allowCustomUrl: true,
    defaultModel: "",
    supportsModelList: true,
    models: [],
  },
];

export function getProvider(id: AiProviderId): AiProviderDef {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export function bedrockRuntimeBaseUrl(region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
}

export function bedrockMantleBaseUrl(region: string): string {
  return `https://bedrock-mantle.${region}.api.aws/v1`;
}

export function resolveProviderBaseUrl(
  providerId: AiProviderId,
  region: string,
  customBaseUrl: string,
): string {
  const provider = getProvider(providerId);
  if (providerId === "amazon_bedrock") {
    return bedrockRuntimeBaseUrl(region || "us-east-1");
  }
  if (providerId === "amazon_bedrock_mantle") {
    return bedrockMantleBaseUrl(region || "us-east-1");
  }
  if (provider.allowCustomUrl && customBaseUrl.trim()) {
    return customBaseUrl.trim().replace(/\/+$/, "");
  }
  return (provider.baseUrl ?? customBaseUrl).replace(/\/+$/, "");
}

const ASKED_KEY = "azalea-ai-asked";
const ENABLED_KEY = "azalea-ai-enabled";
const PREFS_KEY = "azalea-ai-prefs";
const CHATS_KEY_V1 = "azalea-ai-chats-v1";
const CHATS_KEY = "azalea-ai-chats-v2";
const MEMORY_KEY = "azalea-ai-memory-v1";
const MAX_THREADS = 80;
const MAX_MEMORY = 40;

export interface AiPrefs {
  providerId: AiProviderId;
  model: string;
  customBaseUrl: string;
  region: string;
  mode: AiMode;
  access: AiAccess;
  includeTerminalContext: boolean;
  webSearchEnabled: boolean;
  webSearchProvider: "mwmbl" | "duckduckgo" | "tavily" | "brave" | "searxng";
  webSearchUrl: string;
  customModels: Partial<Record<AiProviderId, string[]>>;
  providerSettings: Partial<
    Record<
      AiProviderId,
      { model: string; customBaseUrl: string; region: string }
    >
  >;
}

const DEFAULT_PREFS: AiPrefs = {
  providerId: "openai",
  model: "gpt-5-mini",
  customBaseUrl: "",
  region: "us-east-1",
  mode: "ask",
  access: "confirm",
  includeTerminalContext: true,
  webSearchEnabled: true,
  webSearchProvider: "mwmbl",
  webSearchUrl: "",
  customModels: {},
  providerSettings: {},
};

export function getAiAsked(): boolean {
  return localStorage.getItem(ASKED_KEY) === "1";
}

export function setAiAsked() {
  localStorage.setItem(ASKED_KEY, "1");
}

export function isAiEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setAiEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  setAiAsked();
  window.dispatchEvent(
    new CustomEvent("azalea-ai-enabled", { detail: enabled }),
  );
}

export function getAiPrefs(): AiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AiPrefs>;
    const providerId = AI_PROVIDERS.some((p) => p.id === parsed.providerId)
      ? (parsed.providerId as AiProviderId)
      : DEFAULT_PREFS.providerId;
    return {
      providerId,
      model:
        typeof parsed.model === "string"
          ? parsed.model
          : getProvider(providerId).defaultModel,
      customBaseUrl:
        typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",
      region:
        typeof parsed.region === "string" && parsed.region
          ? parsed.region
          : "us-east-1",
      mode: parsed.mode === "agent" ? "agent" : "ask",
      access: parsed.access === "full" ? "full" : "confirm",
      includeTerminalContext: parsed.includeTerminalContext !== false,
      webSearchEnabled: parsed.webSearchEnabled !== false,
      webSearchProvider:
        parsed.webSearchProvider === "duckduckgo" ||
        parsed.webSearchProvider === "tavily" ||
        parsed.webSearchProvider === "brave" ||
        parsed.webSearchProvider === "searxng"
          ? parsed.webSearchProvider
          : "mwmbl",
      webSearchUrl:
        typeof parsed.webSearchUrl === "string" ? parsed.webSearchUrl : "",
      customModels: sanitizeCustomModels(parsed.customModels),
      providerSettings:
        parsed.providerSettings && typeof parsed.providerSettings === "object"
          ? parsed.providerSettings
          : {},
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setAiPrefs(patch: Partial<AiPrefs>) {
  const current = getAiPrefs();
  const next = { ...current, ...patch };
  if (patch.providerId && patch.providerId !== current.providerId) {
    next.providerSettings = {
      ...current.providerSettings,
      [current.providerId]: {
        model: current.model,
        customBaseUrl: current.customBaseUrl,
        region: current.region,
      },
    };
    const saved = current.providerSettings[patch.providerId];
    next.model = saved?.model ?? getProvider(patch.providerId).defaultModel;
    next.customBaseUrl = saved?.customBaseUrl ?? "";
    next.region = saved?.region ?? "us-east-1";
  }
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("azalea-ai-prefs", { detail: next }));
}

function sanitizeCustomModels(value: unknown): AiPrefs["customModels"] {
  if (!value || typeof value !== "object") return {};
  const result: AiPrefs["customModels"] = {};
  for (const provider of AI_PROVIDERS) {
    const ids = (value as Record<string, unknown>)[provider.id];
    if (Array.isArray(ids))
      result[provider.id] = [
        ...new Set(
          ids
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
  }
  return result;
}

export function addCustomAiModels(providerId: AiProviderId, text: string) {
  const prefs = getAiPrefs();
  const added = text
    .split(/[\n,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (!added.length) return;
  const ids = [
    ...new Set([...(prefs.customModels[providerId] ?? []), ...added]),
  ];
  setAiPrefs({
    customModels: { ...prefs.customModels, [providerId]: ids },
    model: added[0],
  });
}

export interface AiChatMessageStored {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  internal?: boolean;
  work?: AiWorkSummary;
}

export interface AiWebSource {
  title: string;
  url: string;
  snippet: string;
}

export interface AiWorkEvent {
  id: string;
  kind: "thinking" | "search" | "command" | "write" | "approval";
  label: string;
  status: "running" | "done" | "error" | "rejected" | "stopped";
  startedAt: number;
  finishedAt?: number;
  detail?: string;
  sources?: AiWebSource[];
  content?: string;
}

export interface AiWorkSummary {
  userMessageId: string;
  elapsedMs: number;
  activeSince?: number;
  status: "running" | "waiting" | "done" | "stopped" | "error";
  events: AiWorkEvent[];
  finalEventId?: string;
}

export interface AiChatThread {
  id: string;
  /** Terminal session that created / last updated this chat. */
  sessionId: string;
  /** Human label e.g. host name or "Local". */
  hostLabel?: string;
  title: string;
  messages: AiChatMessageStored[];
  createdAt: number;
  updatedAt: number;
}

export interface AiMemoryNote {
  id: string;
  text: string;
  source: "user" | "ai";
  createdAt: number;
  updatedAt: number;
}

function migrateChatsV1(): AiChatThread[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY_V1);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, AiChatThread[]>;
    const flat: AiChatThread[] = [];
    for (const [sessionId, list] of Object.entries(all)) {
      for (const t of list ?? []) {
        flat.push({
          ...t,
          sessionId: t.sessionId || sessionId,
          createdAt: t.createdAt ?? t.updatedAt ?? Date.now(),
          updatedAt: t.updatedAt ?? Date.now(),
        });
      }
    }
    flat.sort((a, b) => b.updatedAt - a.updatedAt);
    localStorage.setItem(CHATS_KEY, JSON.stringify(flat.slice(0, MAX_THREADS)));
    localStorage.removeItem(CHATS_KEY_V1);
    return flat.slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

function loadAllThreads(): AiChatThread[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as AiChatThread[];
      return Array.isArray(list)
        ? list
            .map((t) => ({
              ...t,
              messages: t.messages.map((message) => {
                const work = message.work;
                if (
                  !work ||
                  (work.status !== "running" && work.status !== "waiting")
                )
                  return message;
                const stoppedAt = t.updatedAt ?? Date.now();
                return {
                  ...message,
                  work: {
                    ...work,
                    elapsedMs:
                      work.elapsedMs +
                      (work.activeSince === undefined
                        ? 0
                        : Math.max(0, stoppedAt - work.activeSince)),
                    activeSince: undefined,
                    status: "stopped" as const,
                    events: work.events.map((event) =>
                      event.status === "running"
                        ? {
                            ...event,
                            status: "stopped" as const,
                            finishedAt: stoppedAt,
                          }
                        : event,
                    ),
                  },
                };
              }),
              createdAt: t.createdAt ?? t.updatedAt ?? Date.now(),
              updatedAt: t.updatedAt ?? Date.now(),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [];
    }
    return migrateChatsV1();
  } catch {
    return [];
  }
}

function saveAllThreads(list: AiChatThread[]) {
  const sorted = [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);
  localStorage.setItem(CHATS_KEY, JSON.stringify(sorted));
}

/** All chats on this machine, newest first. */
export function listAllAiThreads(): AiChatThread[] {
  return loadAllThreads();
}

export function listAiThreads(sessionId?: string): AiChatThread[] {
  const all = loadAllThreads();
  if (!sessionId) return all;
  return all.filter((t) => t.sessionId === sessionId);
}

export function getAiThread(threadId: string): AiChatThread | null;
export function getAiThread(
  sessionId: string,
  threadId: string,
): AiChatThread | null;
export function getAiThread(a: string, b?: string): AiChatThread | null {
  const threadId = b ?? a;
  return loadAllThreads().find((t) => t.id === threadId) ?? null;
}

export function saveAiThread(thread: AiChatThread) {
  const all = loadAllThreads();
  const next: AiChatThread = {
    ...thread,
    createdAt: thread.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((t) => t.id === thread.id);
  if (idx >= 0) all[idx] = next;
  else all.unshift(next);
  saveAllThreads(all);
}

export function deleteAiThread(threadId: string): void;
export function deleteAiThread(sessionId: string, threadId: string): void;
export function deleteAiThread(a: string, b?: string): void {
  const threadId = b ?? a;
  saveAllThreads(loadAllThreads().filter((t) => t.id !== threadId));
}

export function newAiThreadId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function threadPreview(thread: AiChatThread, max = 96): string {
  const firstUser = thread.messages.find(
    (m) => m.role === "user" && !m.content.startsWith("Command output:"),
  );
  const text = (firstUser?.content || thread.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function searchAiThreads(
  query: string,
  excludeId?: string,
): AiChatThread[] {
  const q = query.trim().toLowerCase();
  const all = loadAllThreads().filter((t) => t.id !== excludeId);
  if (!q) return all;
  const tokens = q.split(/\s+/).filter(Boolean);
  return all.filter((t) => {
    const hay =
      `${t.title}\n${t.hostLabel ?? ""}\n${t.messages.map((m) => m.content).join("\n")}`.toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

/** Short snippets from older chats that match the current question. */
export function findRelatedAiThreads(
  query: string,
  excludeId?: string,
  limit = 3,
): {
  id: string;
  title: string;
  hostLabel?: string;
  snippet: string;
  updatedAt: number;
}[] {
  const hits = searchAiThreads(query, excludeId).slice(0, limit);
  return hits.map((t) => {
    const userMsgs = t.messages.filter(
      (m) => m.role === "user" && !m.content.startsWith("Command output:"),
    );
    const asst = t.messages.filter(
      (m) => m.role === "assistant" && m.content.trim(),
    );
    const snippet = [userMsgs[0]?.content, asst[0]?.content]
      .filter(Boolean)
      .join("\n---\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    return {
      id: t.id,
      title: t.title || "Chat",
      hostLabel: t.hostLabel,
      snippet: snippet || threadPreview(t, 160),
      updatedAt: t.updatedAt,
    };
  });
}

function loadMemory(): AiMemoryNote[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as AiMemoryNote[];
    return Array.isArray(list)
      ? list.sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
  } catch {
    return [];
  }
}

function saveMemory(notes: AiMemoryNote[]) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(notes.slice(0, MAX_MEMORY)));
}

export function getAiMemory(): AiMemoryNote[] {
  return loadMemory();
}

export function addAiMemory(
  text: string,
  source: "user" | "ai" = "user",
): AiMemoryNote | null {
  const cleaned = text.replace(/^[-*•]\s+/, "").trim();
  if (!cleaned) return null;
  const notes = loadMemory();
  const norm = cleaned.toLowerCase();
  const existing = notes.find((n) => n.text.toLowerCase() === norm);
  if (existing) {
    existing.updatedAt = Date.now();
    existing.source = source;
    saveMemory(notes);
    return existing;
  }
  const note: AiMemoryNote = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: cleaned,
    source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.unshift(note);
  saveMemory(notes);
  return note;
}

export function updateAiMemory(id: string, text: string): void {
  const cleaned = text.trim();
  if (!cleaned) {
    deleteAiMemory(id);
    return;
  }
  const notes = loadMemory();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  notes[idx] = { ...notes[idx], text: cleaned, updatedAt: Date.now() };
  saveMemory(notes);
}

export function deleteAiMemory(id: string): void {
  saveMemory(loadMemory().filter((n) => n.id !== id));
}

export function clearAiMemory(): void {
  localStorage.removeItem(MEMORY_KEY);
}

/** Apply ```memory / ```forget-memory blocks from an assistant reply. */
export function applyMemoryBlocksFromText(text: string): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  const memRe = /```memory\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = memRe.exec(text))) {
    for (const line of m[1].split("\n")) {
      if (addAiMemory(line, "ai")) added += 1;
    }
  }
  const forgetRe = /```forget-memory\s*\n([\s\S]*?)```/gi;
  let notes = loadMemory();
  while ((m = forgetRe.exec(text))) {
    for (const line of m[1].split("\n")) {
      const needle = line
        .replace(/^[-*•]\s+/, "")
        .trim()
        .toLowerCase();
      if (!needle) continue;
      const before = notes.length;
      notes = notes.filter(
        (n) => n.id !== needle && !n.text.toLowerCase().includes(needle),
      );
      removed += before - notes.length;
    }
  }
  if (removed > 0) saveMemory(notes);
  return { added, removed };
}

export function formatMemoryForPrompt(): string {
  const notes = getAiMemory();
  if (!notes.length) return "";
  return [
    "Local memory on this machine (durable notes; keep private facts out of replies unless useful):",
    ...notes.map((n) => `- ${n.text}`),
  ].join("\n");
}

export function formatHistoryCatalogForPrompt(
  excludeId?: string,
  limit = 8,
): string {
  const threads = listAllAiThreads()
    .filter(
      (t) => t.id !== excludeId && t.messages.some((m) => m.role === "user"),
    )
    .slice(0, limit);
  if (!threads.length) return "";
  return [
    "Older local chats on this PC (titles only; ask the user or search context if you need details):",
    ...threads.map((t) => {
      const when = new Date(t.updatedAt).toLocaleString();
      const host = t.hostLabel ? ` @ ${t.hostLabel}` : "";
      return `- [${t.id}] ${t.title || "Chat"}${host} (${when})`;
    }),
  ].join("\n");
}

export function formatRelatedChatsForPrompt(
  query: string,
  excludeId?: string,
  limit = 3,
): string {
  const related = findRelatedAiThreads(query, excludeId, limit);
  if (!related.length) return "";
  return [
    "Possibly relevant snippets from prior local chats:",
    ...related.map((r, i) => {
      const host = r.hostLabel ? ` @ ${r.hostLabel}` : "";
      return `### Prior chat ${i + 1}: ${r.title}${host}\n${r.snippet}`;
    }),
  ].join("\n\n");
}

export interface AiSettingsExport {
  enabled: boolean;
  prefs: AiPrefs;
}

export function collectAiSettings(): AiSettingsExport {
  return {
    enabled: isAiEnabled(),
    prefs: getAiPrefs(),
  };
}

export function applyAiSettings(
  settings: Partial<AiSettingsExport> | undefined,
) {
  if (!settings) return;
  if (typeof settings.enabled === "boolean") {
    setAiEnabled(settings.enabled);
  }
  if (settings.prefs && typeof settings.prefs === "object") {
    setAiPrefs(settings.prefs);
  }
}

export function parseSuggestedCommands(text: string): string[] {
  return parseSuggestedActions(text)
    .filter(
      (a): a is Extract<AiPendingAction, { type: "shell" }> =>
        a.type === "shell",
    )
    .map((a) => a.command);
}

export interface AiFileWrite {
  path: string;
  content: string;
}

export type AiPendingAction =
  | { type: "shell"; command: string }
  | { type: "write"; path: string; content: string };

export function parseSuggestedFileWrites(text: string): AiFileWrite[] {
  return parseSuggestedActions(text)
    .filter(
      (a): a is Extract<AiPendingAction, { type: "write" }> =>
        a.type === "write",
    )
    .map((a) => ({ path: a.path, content: a.content }));
}

/** Ordered shell + write actions from an assistant reply. */
export function parseSuggestedActions(text: string): AiPendingAction[] {
  const out: AiPendingAction[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const header = (m[1] || "").trim();
    const body = m[2].replace(/\n$/, "");
    const writeMatch = /^write\s+path=(.+)$/i.exec(header);
    if (writeMatch) {
      const path = writeMatch[1].trim();
      if (path) out.push({ type: "write", path, content: body });
      continue;
    }
    if (/^(bash|sh|shell|zsh|powershell|pwsh|ps1)?$/i.test(header)) {
      const command = body.trim();
      if (
        command &&
        command
          .split("\n")
          .some((line) => line.trim() && !line.trim().startsWith("#"))
      ) {
        out.push({ type: "shell", command });
      }
    }
  }
  return out;
}

export function pendingActionKey(action: AiPendingAction): string {
  if (action.type === "shell") return `shell:${action.command}`;
  return `write:${action.path}\n${action.content}`;
}

export function pendingActionsEqual(
  a: AiPendingAction,
  b: AiPendingAction,
): boolean {
  return pendingActionKey(a) === pendingActionKey(b);
}

export function exportAiThreadsJson(threads: AiChatThread[]): string {
  return `${JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      threads,
    },
    null,
    2,
  )}\n`;
}

export function buildSystemPrompt(
  mode: AiMode,
  access: AiAccess,
  osHint?: string | null,
): string {
  const os = osHint?.trim() || "unknown Linux/Unix";
  const memoryHints = [
    "You may save durable facts with a fenced ```memory block (one fact per line).",
    "To drop outdated memory, use a fenced ```forget-memory block with matching text.",
    "Only store useful durable notes (host OS quirks, preferred tools, project paths). Never store passwords or API keys.",
  ];
  const writeHint =
    "To write a remote file via SFTP, use a fenced block like ```write path=/absolute/or/relative/file\\n...contents...``` (never put secrets or keys in file contents).";
  if (mode === "ask") {
    return [
      "You are Azalea Ask, a capable assistant inside an SSH/local terminal client.",
      `Remote OS hint: ${os}.`,
      "Be concrete and helpful. Use markdown. Put runnable shell commands in fenced ```bash blocks.",
      writeHint,
      "Do not claim you executed anything. The user Inserts, Runs, or Writes.",
      "Never ask for passwords or API keys.",
      "You can use local memory and prior chat snippets when provided.",
      ...memoryHints,
    ].join("\n");
  }
  return [
    "You are Azalea Agent inside an SSH/local terminal client.",
    `Remote OS hint: ${os}.`,
    access === "full"
      ? "Access mode is FULL: ```bash and ```write blocks run automatically. Prefer safe, reversible steps."
      : "Access mode is CONFIRM: the user approves each ```bash / ```write before it runs.",
    "Put each executable command in its own ```bash fence. Explain briefly before/after.",
    writeHint,
    "After a command or write runs you will receive its result. Use that to decide the next step.",
    "When the task is finished, reply with a short summary and no bash/write fences.",
    "Never ask for passwords or API keys in chat.",
    "You can use local memory and prior chat snippets when provided.",
    ...memoryHints,
  ].join("\n");
}

/** Strip CSI / OSC sequences so models see readable terminal output. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}
