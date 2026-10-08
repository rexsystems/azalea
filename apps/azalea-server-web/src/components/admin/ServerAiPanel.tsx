"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "@/lib/azalea-api";
import {
  getServerAiSettings,
  saveServerAiSettings,
  getServerProviderModels,
  type ServerAiSettings,
  type ServerAiProvider,
} from "@/lib/admin-api";
import { CustomSelect } from "@/components/CustomSelect";
import { ApprovalToggle } from "./ApprovalToggle";

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    dialect: "openai",
    url: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    dialect: "anthropic",
    url: "https://api.anthropic.com",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    dialect: "openai",
    url: "https://api.deepseek.com/v1",
  },
  {
    id: "groq",
    name: "Groq",
    dialect: "openai",
    url: "https://api.groq.com/openai/v1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    dialect: "openai",
    url: "https://openrouter.ai/api/v1",
  },
  {
    id: "ollama",
    name: "Ollama",
    dialect: "openai",
    url: "http://ollama:11434/v1",
  },
  {
    id: "amazon_bedrock",
    name: "Bedrock Runtime",
    dialect: "openai",
    url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
  },
  {
    id: "amazon_bedrock_mantle",
    name: "Bedrock Mantle",
    dialect: "openai",
    url: "https://bedrock-mantle.us-east-1.api.aws/v1",
  },
  {
    id: "custom_openai",
    name: "Custom OpenAI-compatible",
    dialect: "openai",
    url: "",
  },
  {
    id: "custom_anthropic",
    name: "Custom Anthropic-compatible",
    dialect: "anthropic",
    url: "",
  },
] as const;
type DraftProvider = ServerAiProvider & {
  api_key?: string;
  clear_key?: boolean;
};
type Draft = Omit<ServerAiSettings, "providers"> & {
  providers: DraftProvider[];
};

function connectionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function ServerAiPanel({ onDenied }: { onDenied: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<ServerAiSettings | null>(null);
  const [catalogs, setCatalogs] = useState<
    Record<string, ServerAiProvider["models"]>
  >({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => {
    const settings = await getServerAiSettings();
    setSaved(settings);
    setDraft(settings);
    setCatalogs({});
    setModelDrafts({});
    setError(null);
    setMessage(null);
  };
  useEffect(() => {
    void reload().catch((err) => {
      if (err instanceof ApiRequestError && err.status === 403) onDenied();
      else setError(String(err));
    });
  }, [onDenied]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const update = (id: string, patch: Partial<DraftProvider>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.id === id ? { ...provider, ...patch } : provider,
            ),
            default_model:
              patch.models &&
              current.default_model.startsWith(`${id}::`) &&
              !patch.models.some(
                (model) => `${id}::${model.id}` === current.default_model,
              )
                ? ""
                : current.default_model,
          }
        : current,
    );
  const modelOptions = useMemo(
    () =>
      draft?.providers.flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.id}::${model.id}`,
          label: `${provider.name} · ${model.label || model.id}`,
        })),
      ) ?? [],
    [draft],
  );
  if (!draft)
    return (
      <section className="rex-card">
        <p className="rex-hint">{error ?? "Loading AI configuration…"}</p>
        {error && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void run(reload)}
          >
            Retry
          </button>
        )}
      </section>
    );
  return (
    <div className="server-ai-panel">
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-success" role="status">
          {message}
        </p>
      )}
      <section className="rex-card">
        <div className="rex-card-head">
          <div>
            <h2>Shared AI</h2>
            <p className="rex-hint">
              Enabled users access these models through their signed-in desktop
              account. Provider keys stay encrypted on this server.
            </p>
          </div>
          <ApprovalToggle
            approved={draft.enabled}
            approvedLabel="Enabled"
            pendingLabel="Disabled"
            disabled={busy}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
        <div className="server-ai-grid">
          <label className="rex-label">
            Default model
            <CustomSelect
              ariaLabel="Default server model"
              value={draft.default_model}
              options={[
                { value: "", label: "Choose a configured model" },
                ...modelOptions,
              ]}
              onChange={(default_model) =>
                setDraft({ ...draft, default_model })
              }
              disabled={busy}
            />
          </label>
          <label className="rex-label">
            Requests per user / minute
            <input
              className="field"
              type="number"
              min={1}
              max={120}
              disabled={busy}
              value={draft.requests_per_minute}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  requests_per_minute: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="rex-label">
            Maximum output tokens
            <input
              className="field"
              type="number"
              min={256}
              max={32768}
              disabled={busy}
              value={draft.max_output_tokens}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  max_output_tokens: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
      </section>
      <div className="server-ai-toolbar">
        <div>
          <h2>Provider connections</h2>
          <p className="rex-hint">
            Load real model IDs from a saved provider, then choose which ones
            users can access.
          </p>
        </div>
        <button
          className="btn btn-ghost"
          disabled={busy || draft.providers.length >= 20}
          onClick={() =>
            setDraft({
              ...draft,
              providers: [
                ...draft.providers,
                {
                  id: connectionId(),
                  name: "OpenAI",
                  provider: "openai",
                  dialect: "openai",
                  base_url: "https://api.openai.com/v1",
                  models: [],
                  key_configured: false,
                },
              ],
            })
          }
        >
          Add provider
        </button>
      </div>
      {draft.providers.length === 0 && (
        <section className="rex-card">
          <p className="rex-hint">
            Add a provider to share AI with this instance.
          </p>
        </section>
      )}
      {draft.providers.map((provider) => {
        const previous = saved?.providers.find((row) => row.id === provider.id);
        const connectionSaved =
          previous &&
          previous.provider === provider.provider &&
          previous.base_url === provider.base_url &&
          previous.dialect === provider.dialect &&
          !provider.api_key?.trim() &&
          !provider.clear_key;
        const catalog = catalogs[provider.id] ?? [];
        const query = (searches[provider.id] ?? "").toLowerCase();
        const filtered = catalog.filter((model) =>
          `${model.id} ${model.label}`.toLowerCase().includes(query),
        );
        return (
          <section key={provider.id} className="rex-card">
            <div className="rex-card-head">
              <div>
                <h2>{provider.name || "Provider"}</h2>
                <span>
                  {provider.models.length} models available ·{" "}
                  {provider.provider === "ollama"
                    ? "No key required"
                    : provider.clear_key
                      ? "Key will be removed"
                      : provider.key_configured
                        ? "Key saved"
                        : "Key not saved"}
                </span>
              </div>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() =>
                  setDraft({
                    ...draft,
                    providers: draft.providers.filter(
                      (row) => row.id !== provider.id,
                    ),
                    default_model: draft.default_model.startsWith(
                      `${provider.id}::`,
                    )
                      ? ""
                      : draft.default_model,
                  })
                }
              >
                Remove
              </button>
            </div>
            <div className="server-ai-grid">
              <label className="rex-label">
                Connection name
                <input
                  className="field"
                  disabled={busy}
                  value={provider.name}
                  onChange={(e) =>
                    update(provider.id, { name: e.target.value })
                  }
                />
              </label>
              <label className="rex-label">
                Provider
                <CustomSelect
                  ariaLabel="AI provider"
                  disabled={busy}
                  value={provider.provider}
                  options={PROVIDERS.map((row) => ({
                    value: row.id,
                    label: row.name,
                  }))}
                  onChange={(id) => {
                    const chosen = PROVIDERS.find((row) => row.id === id)!;
                    update(provider.id, {
                      provider: id,
                      name: chosen.name,
                      dialect: chosen.dialect,
                      base_url: chosen.url,
                      models: [],
                      api_key: "",
                      clear_key: true,
                    });
                    setCatalogs((current) => ({
                      ...current,
                      [provider.id]: [],
                    }));
                    if (draft.default_model.startsWith(`${provider.id}::`))
                      setDraft((current) =>
                        current ? { ...current, default_model: "" } : current,
                      );
                  }}
                />
              </label>
              <label className="rex-label">
                Base URL
                <input
                  className="field"
                  disabled={busy}
                  value={provider.base_url}
                  placeholder="https://provider.example/v1"
                  onChange={(e) =>
                    update(provider.id, { base_url: e.target.value })
                  }
                />
              </label>
            </div>
            {provider.provider !== "ollama" && (
              <div className="server-ai-key">
                <label className="rex-label">
                  API key
                  <input
                    className="field"
                    type="password"
                    autoComplete="off"
                    disabled={busy}
                    value={provider.api_key ?? ""}
                    placeholder={
                      provider.key_configured
                        ? "Leave blank to keep the saved key"
                        : "Provider API key"
                    }
                    onChange={(e) =>
                      update(provider.id, {
                        api_key: e.target.value,
                        clear_key: false,
                      })
                    }
                  />
                </label>
                <label className="rex-hint">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={provider.clear_key ?? false}
                    onChange={(e) =>
                      update(provider.id, {
                        clear_key: e.target.checked,
                        api_key: "",
                      })
                    }
                  />{" "}
                  Remove saved key on save
                </label>
              </div>
            )}
            <div className="server-ai-toolbar">
              <h3>Available models</h3>
              <button
                className="btn btn-ghost"
                disabled={
                  busy ||
                  !connectionSaved ||
                  provider.provider === "amazon_bedrock"
                }
                title={
                  !connectionSaved
                    ? "Save the connection before loading its catalog"
                    : undefined
                }
                onClick={() =>
                  void run(async () => {
                    const rows = await getServerProviderModels(provider.id);
                    setCatalogs((current) => ({
                      ...current,
                      [provider.id]: rows,
                    }));
                    setMessage(
                      `${rows.length} models loaded from ${provider.name}.`,
                    );
                  })
                }
              >
                Load models
              </button>
            </div>
            {catalog.length > 0 && (
              <div className="server-ai-catalog">
                <input
                  className="field"
                  aria-label="Filter model catalog"
                  placeholder="Filter provider models…"
                  value={searches[provider.id] ?? ""}
                  onChange={(e) =>
                    setSearches((current) => ({
                      ...current,
                      [provider.id]: e.target.value,
                    }))
                  }
                />
                <div className="server-ai-model-list">
                  {filtered.map((model) => (
                    <label key={model.id} className="server-ai-model">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={provider.models.some(
                          (row) => row.id === model.id,
                        )}
                        onChange={(e) =>
                          update(provider.id, {
                            models: e.target.checked
                              ? [...provider.models, model]
                              : provider.models.filter(
                                  (row) => row.id !== model.id,
                                ),
                          })
                        }
                      />
                      <span>
                        {model.label}
                        <small>{model.id}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="server-ai-model-tags">
              {provider.models.map((model) => (
                <span key={model.id} className="rex-pill">
                  {model.id}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${model.id}`}
                    onClick={() =>
                      update(provider.id, {
                        models: provider.models.filter(
                          (row) => row.id !== model.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="server-ai-key">
              <input
                className="field"
                aria-label="Custom model IDs"
                placeholder="Exact model IDs, separated by commas"
                disabled={busy}
                value={modelDrafts[provider.id] ?? ""}
                onChange={(e) =>
                  setModelDrafts((current) => ({
                    ...current,
                    [provider.id]: e.target.value,
                  }))
                }
              />
              <button
                className="btn btn-ghost"
                disabled={busy || !(modelDrafts[provider.id] ?? "").trim()}
                onClick={() => {
                  const ids = (modelDrafts[provider.id] ?? "")
                    .split(/[\n,]+/)
                    .map((id) => id.trim())
                    .filter(Boolean);
                  const models = new Map(
                    provider.models.map((model) => [model.id, model]),
                  );
                  for (const id of ids)
                    if (!models.has(id)) models.set(id, { id, label: id });
                  update(provider.id, { models: [...models.values()] });
                  setModelDrafts((current) => ({
                    ...current,
                    [provider.id]: "",
                  }));
                }}
              >
                Add IDs
              </button>
            </div>
          </section>
        );
      })}
      <div className="server-ai-save">
        <p className="rex-hint">
          Changes apply after saving. Removing a connection removes its saved
          key; discard restores the saved configuration.
        </p>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void run(reload)}
        >
          Discard changes
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await saveServerAiSettings(draft);
              setSaved(next);
              setDraft(next);
              setMessage(
                "Server AI settings saved. Desktop users can refresh their server model list.",
              );
            })
          }
        >
          {busy ? "Saving…" : "Save AI settings"}
        </button>
      </div>
    </div>
  );
}
