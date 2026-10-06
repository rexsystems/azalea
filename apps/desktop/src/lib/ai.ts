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
const CHATS_KEY = "azalea-ai-chats-v1";

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
  sessionId: string;
  title: string;
  messages: AiChatMessageStored[];
  updatedAt: number;
}

function loadAllChats(): Record<string, AiChatThread[]> {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, AiChatThread[]>;
  } catch {
    return {};
  }
}

function saveAllChats(all: Record<string, AiChatThread[]>) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(all));
}

export function listAiThreads(sessionId: string): AiChatThread[] {
  const all = loadAllChats();
  return (all[sessionId] ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getAiThread(sessionId: string, threadId: string): AiChatThread | null {
  return listAiThreads(sessionId).find((t) => t.id === threadId) ?? null;
}

export function saveAiThread(thread: AiChatThread) {
  const all = loadAllChats();
  const list = all[thread.sessionId] ?? [];
  const idx = list.findIndex((t) => t.id === thread.id);
  if (idx >= 0) list[idx] = thread;
  else list.unshift(thread);
  all[thread.sessionId] = list.slice(0, 40);
  saveAllChats(all);
}

export function deleteAiThread(sessionId: string, threadId: string) {
  const all = loadAllChats();
  all[sessionId] = (all[sessionId] ?? []).filter((t) => t.id !== threadId);
  saveAllChats(all);
}

export function newAiThreadId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const out: string[] = [];
  const re = /```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[1]
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .join("\n")
      .trim();
    if (body) out.push(body);
  }
  return out;
}

export function buildSystemPrompt(mode: AiMode, access: AiAccess, osHint?: string | null): string {
  const os = osHint?.trim() || "unknown Linux/Unix";
  if (mode === "ask") {
    return [
      "You are Azalea Ask, a capable assistant inside an SSH/local terminal client.",
      `Remote OS hint: ${os}.`,
      "Be concrete and helpful. Use markdown. Put runnable shell commands in fenced ```bash blocks.",
      "Do not claim you executed anything. The user Inserts or Runs commands.",
      "Never ask for passwords or API keys.",
    ].join("\n");
  }
  return [
    "You are Azalea Agent inside an SSH/local terminal client.",
    `Remote OS hint: ${os}.`,
    access === "full"
      ? "Access mode is FULL: commands in ```bash blocks may run automatically. Prefer safe, reversible steps."
      : "Access mode is CONFIRM: the user approves each command before it runs.",
    "Put each executable command in its own ```bash fence. Explain briefly before/after.",
    "Never ask for passwords or API keys in chat.",
  ].join("\n");
}
