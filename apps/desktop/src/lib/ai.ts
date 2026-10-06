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

function m(id: string, label: string): AiModelOption {
  return { id, label };
}

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
    models: [
      m("gpt-5.5", "GPT-5.5"),
      m("gpt-5", "GPT-5"),
      m("gpt-5-mini", "GPT-5 Mini"),
      m("gpt-5-nano", "GPT-5 Nano"),
      m("gpt-5-chat-latest", "GPT-5 Chat"),
      m("gpt-4.1", "GPT-4.1"),
      m("gpt-4.1-mini", "GPT-4.1 Mini"),
      m("gpt-4.1-nano", "GPT-4.1 Nano"),
      m("gpt-4o", "GPT-4o"),
      m("gpt-4o-mini", "GPT-4o Mini"),
      m("o3", "o3"),
      m("o4-mini", "o4-mini"),
      m("o3-mini", "o3-mini"),
    ],
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
    defaultModel: "claude-sonnet-5-5",
    supportsModelList: false,
    models: [
      m("claude-fable-5-1", "Claude Fable 5.1"),
      m("claude-opus-5-5", "Claude Opus 5.5"),
      m("claude-sonnet-5-5", "Claude Sonnet 5.5"),
      m("claude-opus-5", "Claude Opus 5"),
      m("claude-sonnet-5", "Claude Sonnet 5"),
      m("claude-opus-4-8", "Claude Opus 4.8"),
      m("claude-opus-4-7", "Claude Opus 4.7"),
      m("claude-opus-4-6", "Claude Opus 4.6"),
      m("claude-sonnet-4-6", "Claude Sonnet 4.6"),
      m("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
      m("claude-opus-4-5-20251101", "Claude Opus 4.5"),
      m("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    ],
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
    models: [
      m("deepseek-chat", "DeepSeek Chat (V3)"),
      m("deepseek-reasoner", "DeepSeek Reasoner (R1)"),
    ],
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
    models: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B"),
      m("llama-3.1-8b-instant", "Llama 3.1 8B Instant"),
      m("meta-llama/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick"),
      m("meta-llama/llama-4-scout-17b-16e-instruct", "Llama 4 Scout"),
      m("qwen/qwen3-32b", "Qwen3 32B"),
      m("moonshotai/kimi-k2-instruct", "Kimi K2"),
      m("openai/gpt-oss-120b", "GPT-OSS 120B"),
      m("openai/gpt-oss-20b", "GPT-OSS 20B"),
    ],
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
    models: [
      m("openai/gpt-5.5", "OpenAI GPT-5.5"),
      m("openai/gpt-5", "OpenAI GPT-5"),
      m("openai/gpt-5-mini", "OpenAI GPT-5 Mini"),
      m("openai/gpt-4.1", "OpenAI GPT-4.1"),
      m("anthropic/claude-opus-4.5", "Claude Opus 4.5"),
      m("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5"),
      m("anthropic/claude-haiku-4.5", "Claude Haiku 4.5"),
      m("google/gemini-2.5-pro", "Gemini 2.5 Pro"),
      m("google/gemini-2.5-flash", "Gemini 2.5 Flash"),
      m("deepseek/deepseek-chat-v3-0324", "DeepSeek V3"),
      m("deepseek/deepseek-r1", "DeepSeek R1"),
      m("meta-llama/llama-4-maverick", "Llama 4 Maverick"),
      m("qwen/qwen3-235b-a22b", "Qwen3 235B"),
      m("x-ai/grok-3", "Grok 3"),
      m("x-ai/grok-3-mini", "Grok 3 Mini"),
    ],
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
    defaultModel: "llama3.2",
    supportsModelList: true,
    models: [
      m("llama3.2", "Llama 3.2"),
      m("llama3.1", "Llama 3.1"),
      m("llama3.3", "Llama 3.3"),
      m("qwen2.5", "Qwen 2.5"),
      m("qwen2.5-coder", "Qwen 2.5 Coder"),
      m("deepseek-r1", "DeepSeek R1"),
      m("mistral", "Mistral"),
      m("codellama", "Code Llama"),
      m("phi4", "Phi-4"),
      m("gemma3", "Gemma 3"),
    ],
  },
  {
    id: "amazon_bedrock",
    name: "Amazon Bedrock",
    description: "Bedrock Runtime OpenAI-compatible endpoint. Paste a Bedrock API key.",
    dialect: "openai",
    baseUrl: null,
    needsRegion: true,
    regionKind: "bedrock_runtime",
    allowCustomUrl: false,
    defaultModel: "anthropic.claude-sonnet-4-6",
    supportsModelList: true,
    models: [
      m("anthropic.claude-sonnet-4-6", "Claude Sonnet 4.6"),
      m("anthropic.claude-opus-4-6-v1", "Claude Opus 4.6"),
      m("anthropic.claude-sonnet-4-5-20250929-v1:0", "Claude Sonnet 4.5"),
      m("anthropic.claude-haiku-4-5-20251001-v1:0", "Claude Haiku 4.5"),
      m("amazon.nova-premier-v1:0", "Amazon Nova Premier"),
      m("amazon.nova-pro-v1:0", "Amazon Nova Pro"),
      m("amazon.nova-lite-v1:0", "Amazon Nova Lite"),
      m("amazon.nova-micro-v1:0", "Amazon Nova Micro"),
      m("us.anthropic.claude-sonnet-4-6", "Claude Sonnet 4.6 (US CRIS)"),
      m("us.anthropic.claude-opus-4-6-v1", "Claude Opus 4.6 (US CRIS)"),
      m("meta.llama3-3-70b-instruct-v1:0", "Llama 3.3 70B"),
      m("deepseek.r1-v1:0", "DeepSeek R1"),
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
    defaultModel: "anthropic.claude-sonnet-4-6",
    supportsModelList: true,
    models: [
      m("anthropic.claude-sonnet-4-6", "Claude Sonnet 4.6"),
      m("anthropic.claude-opus-4-6", "Claude Opus 4.6"),
      m("anthropic.claude-haiku-4-5", "Claude Haiku 4.5"),
      m("amazon.nova-pro-v1:0", "Amazon Nova Pro"),
      m("amazon.nova-lite-v1:0", "Amazon Nova Lite"),
      m("openai.gpt-oss-120b", "GPT-OSS 120B"),
      m("openai.gpt-oss-20b", "GPT-OSS 20B"),
    ],
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
    supportsModelList: false,
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
}

const DEFAULT_PREFS: AiPrefs = {
  providerId: "openai",
  model: "gpt-5-mini",
  customBaseUrl: "",
  region: "us-east-1",
  mode: "ask",
  access: "confirm",
  includeTerminalContext: true,
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
  window.dispatchEvent(new CustomEvent("azalea-ai-enabled", { detail: enabled }));
}

export function getAiPrefs(): AiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AiPrefs>;
    const providerId = AI_PROVIDERS.some((p) => p.id === parsed.providerId)
      ? (parsed.providerId as AiProviderId)
      : DEFAULT_PREFS.providerId;
    const provider = getProvider(providerId);
    return {
      providerId,
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model
          : provider.defaultModel,
      customBaseUrl: typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",
      region: typeof parsed.region === "string" && parsed.region ? parsed.region : "us-east-1",
      mode: parsed.mode === "agent" ? "agent" : "ask",
      access: parsed.access === "full" ? "full" : "confirm",
      includeTerminalContext: parsed.includeTerminalContext !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setAiPrefs(patch: Partial<AiPrefs>) {
  const next = { ...getAiPrefs(), ...patch };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("azalea-ai-prefs", { detail: next }));
}

export interface AiChatMessageStored {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
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
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
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
export function getAiThread(sessionId: string, threadId: string): AiChatThread | null;
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
  const firstUser = thread.messages.find((m) => m.role === "user" && !m.content.startsWith("Command output:"));
  const text = (firstUser?.content || thread.title || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function searchAiThreads(query: string, excludeId?: string): AiChatThread[] {
  const q = query.trim().toLowerCase();
  const all = loadAllThreads().filter((t) => t.id !== excludeId);
  if (!q) return all;
  const tokens = q.split(/\s+/).filter(Boolean);
  return all.filter((t) => {
    const hay = `${t.title}\n${t.hostLabel ?? ""}\n${t.messages.map((m) => m.content).join("\n")}`.toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

/** Short snippets from older chats that match the current question. */
export function findRelatedAiThreads(
  query: string,
  excludeId?: string,
  limit = 3,
): { id: string; title: string; hostLabel?: string; snippet: string; updatedAt: number }[] {
  const hits = searchAiThreads(query, excludeId).slice(0, limit);
  return hits.map((t) => {
    const userMsgs = t.messages.filter(
      (m) => m.role === "user" && !m.content.startsWith("Command output:"),
    );
    const asst = t.messages.filter((m) => m.role === "assistant" && m.content.trim());
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
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
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

export function addAiMemory(text: string, source: "user" | "ai" = "user"): AiMemoryNote | null {
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
export function applyMemoryBlocksFromText(text: string): { added: number; removed: number } {
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
      const needle = line.replace(/^[-*•]\s+/, "").trim().toLowerCase();
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

export function formatHistoryCatalogForPrompt(excludeId?: string, limit = 8): string {
  const threads = listAllAiThreads()
    .filter((t) => t.id !== excludeId && t.messages.some((m) => m.role === "user"))
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

export function applyAiSettings(settings: Partial<AiSettingsExport> | undefined) {
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
    .filter((a): a is Extract<AiPendingAction, { type: "shell" }> => a.type === "shell")
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
    .filter((a): a is Extract<AiPendingAction, { type: "write" }> => a.type === "write")
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
    if (/^(bash|sh|shell|zsh)?$/i.test(header)) {
      const command = body
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .join("\n")
        .trim();
      if (command) out.push({ type: "shell", command });
    }
  }
  return out;
}

export function pendingActionKey(action: AiPendingAction): string {
  if (action.type === "shell") return `shell:${action.command}`;
  return `write:${action.path}\n${action.content}`;
}

export function pendingActionsEqual(a: AiPendingAction, b: AiPendingAction): boolean {
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

export function buildSystemPrompt(mode: AiMode, access: AiAccess, osHint?: string | null): string {
  const os = osHint?.trim() || "unknown Linux/Unix";
  const memoryHints = [
    "You may save durable facts with a fenced ```memory block (one fact per line).",
    "To drop outdated memory, use a fenced ```forget-memory block with matching text.",
    "Only store useful durable notes (host OS quirks, preferred tools, project paths). Never store passwords or API keys.",
  ];
  const writeHint =
    'To write a remote file via SFTP, use a fenced block like ```write path=/absolute/or/relative/file\\n...contents...``` (never put secrets or keys in file contents).';
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
