import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AI_PROVIDERS,
  BEDROCK_MANTLE_REGIONS,
  BEDROCK_RUNTIME_REGIONS,
  getAiPrefs,
  getProvider,
  isAiEnabled,
  resolveProviderBaseUrl,
  setAiEnabled,
  setAiPrefs,
  type AiAccess,
  type AiMode,
  type AiProviderId,
} from "../lib/ai";
import * as api from "../lib/api";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { SettingToggle } from "./ui/SettingToggle";

function fieldStyle(): CSSProperties {
  return {
    background: "var(--bg-input)",
    borderColor: "var(--border-subtle)",
    color: "var(--text)",
  };
}

export function AiSettingsSection() {
  const [enabled, setEnabled] = useState(() => isAiEnabled());
  const [prefs, setPrefsState] = useState(() => getAiPrefs());
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keyPresent, setKeyPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = getProvider(prefs.providerId);
  const regions = useMemo(() => {
    if (provider.regionKind === "bedrock_mantle") return [...BEDROCK_MANTLE_REGIONS];
    if (provider.regionKind === "bedrock_runtime") return [...BEDROCK_RUNTIME_REGIONS];
    return [];
  }, [provider.regionKind]);

  const derivedUrl = resolveProviderBaseUrl(
    prefs.providerId,
    prefs.region,
    prefs.customBaseUrl,
  );

  const refreshKey = () => {
    void api
      .aiApiKeyPresent(prefs.providerId)
      .then(setKeyPresent)
      .catch(() => setKeyPresent(false));
  };

  useEffect(() => {
    refreshKey();
    setApiKeyDraft("");
    setStatus(null);
    setError(null);
  }, [prefs.providerId]);

  const patchPrefs = (patch: Partial<typeof prefs>) => {
    setAiPrefs(patch);
    setPrefsState(getAiPrefs());
  };

  const saveKey = async () => {
    if (!apiKeyDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.aiSetApiKey(prefs.providerId, apiKeyDraft.trim());
      setApiKeyDraft("");
      setKeyPresent(true);
      setStatus("API key saved to the OS keychain.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.aiClearApiKey(prefs.providerId);
      setKeyPresent(false);
      setStatus("API key removed.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setError(null);
    setStatus("Testing…");
    try {
      const result = await api.aiChat({
        providerId: prefs.providerId,
        dialect: provider.dialect,
        baseUrl: derivedUrl,
        model: prefs.model,
        messages: [
          { role: "system", content: "Reply with exactly: ok" },
          { role: "user", content: "ping" },
        ],
      });
      setStatus(`Connected. Reply: ${result.content.slice(0, 120)}`);
    } catch (err) {
      setStatus(null);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-6 space-y-2">
        <SettingToggle
          label="Enable AI features"
          description="When off, AI stays hidden everywhere except this Settings tab. Keys stay in your keychain."
          checked={enabled}
          onChange={(on) => {
            setAiEnabled(on);
            setEnabled(on);
          }}
        />
      </div>

      {!enabled ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          AI is off. Turn it on above to configure providers and use Ask / Agent in the terminal.
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium" style={{ color: "var(--text)" }}>
              Provider
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {AI_PROVIDERS.map((p) => {
                const selected = prefs.providerId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const nextModel =
                        prefs.providerId === p.id
                          ? prefs.model
                          : p.defaultModel || prefs.model;
                      patchPrefs({
                        providerId: p.id as AiProviderId,
                        model: nextModel,
                        region:
                          p.regionKind === "none"
                            ? prefs.region
                            : prefs.region || "us-east-1",
                      });
                    }}
                    className="hover-subtle rounded-xl border px-3 py-3 text-left"
                    style={{
                      background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                      borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                    }}
                  >
                    <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                      {p.name}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {p.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {provider.needsRegion && (
            <Select
              label="AWS region"
              value={prefs.region}
              options={regions.map((r) => ({ value: r, label: r }))}
              onChange={(region) => patchPrefs({ region })}
            />
          )}

          {(provider.allowCustomUrl || !provider.baseUrl) && !provider.needsRegion && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Base URL
              </span>
              <input
                value={prefs.customBaseUrl}
                onChange={(e) => patchPrefs({ customBaseUrl: e.target.value })}
                placeholder={
                  provider.id === "ollama"
                    ? "http://127.0.0.1:11434/v1"
                    : "https://example.com/v1"
                }
                className="rounded-lg border px-3 py-2 text-sm outline-none"
                style={fieldStyle()}
              />
            </label>
          )}

          {provider.needsRegion && (
            <div
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-card)",
                color: "var(--text-muted)",
              }}
            >
              Endpoint: <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{derivedUrl}</span>
            </div>
          )}

          <Select
            label="Model"
            value={prefs.model}
            options={[
              ...provider.models.map((m) => ({ value: m.id, label: m.label })),
              ...(prefs.model && !provider.models.some((m) => m.id === prefs.model)
                ? [{ value: prefs.model, label: prefs.model }]
                : []),
            ]}
            onChange={(model) => patchPrefs({ model })}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Or paste a custom model id
            </span>
            <input
              value={prefs.model}
              onChange={(e) => patchPrefs({ model: e.target.value })}
              placeholder="model id"
              className="rounded-lg border px-3 py-2 font-mono text-sm outline-none"
              style={fieldStyle()}
            />
          </label>

          <div className="space-y-2">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              API key
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {keyPresent
                ? "A key is saved in the OS keychain for this provider. Paste a new one to replace it."
                : "Paste your key. It is stored in the OS keychain, not in backups."}
            </p>
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={keyPresent ? "•••••••• (replace)" : "sk-… or Bedrock API key"}
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
              style={fieldStyle()}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !apiKeyDraft.trim()} onClick={() => void saveKey()}>
                Save key
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !keyPresent}
                onClick={() => void clearKey()}
              >
                Clear key
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !keyPresent || !prefs.model.trim()}
                onClick={() => void testConnection()}
              >
                Test connection
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Default mode"
              value={prefs.mode}
              options={[
                { value: "ask", label: "Ask" },
                { value: "agent", label: "Agent" },
              ]}
              onChange={(mode) => patchPrefs({ mode: mode as AiMode })}
            />
            <Select
              label="Default access"
              value={prefs.access}
              options={[
                { value: "confirm", label: "Confirm each command" },
                { value: "full", label: "Full access (no approval)" },
              ]}
              onChange={(access) => patchPrefs({ access: access as AiAccess })}
            />
          </div>

          {prefs.access === "full" && (
            <div
              className="rounded-xl border px-3.5 py-3 text-xs leading-relaxed"
              style={{
                borderColor: "rgba(248,113,113,0.35)",
                background: "rgba(248,113,113,0.08)",
                color: "#fca5a5",
              }}
            >
              Full access lets Agent run suggested shell commands on the active session without asking.
              Destructive commands can wipe data. Prefer Confirm unless you trust the model and host.
            </div>
          )}

          {status && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {status}
            </p>
          )}
          {error && (
            <p className="text-xs" style={{ color: "#f87171" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
