import { useCallback, useEffect, useMemo, useState } from "react";
import { aiListModels, aiServerConfig, type AiServerConfig } from "../lib/api";
import {
  getProvider,
  resolveProviderBaseUrl,
  type AiPrefs,
  type AiModelOption,
  getAiPrefs,
  setAiPrefs,
} from "../lib/ai";

const cache = new Map<string, AiModelOption[]>();

export function useAiModels(prefs: AiPrefs) {
  const provider = getProvider(prefs.providerId);
  const url = resolveProviderBaseUrl(
    prefs.providerId,
    prefs.region,
    prefs.customBaseUrl,
  );
  const scope = `${prefs.providerId}:${url}`;
  const [catalog, setCatalog] = useState<{
    scope: string;
    models: AiModelOption[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [serverConfig, setServerConfig] = useState<AiServerConfig | null>(null);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    if (provider.id !== "selfhost_server") return;
    const changed = () => { setCatalog(null); setServerConfig(null); refresh(); };
    window.addEventListener("azalea-active-account", changed);
    return () => window.removeEventListener("azalea-active-account", changed);
  }, [provider.id, refresh]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(false);
    setServerConfig(null);
    if (!provider.supportsModelList || (!url && provider.id !== "selfhost_server")) return;
    setLoading(true);
    const load = async () => {
      if (provider.id !== "selfhost_server") return aiListModels(provider.id, url);
      const config = await aiServerConfig();
      if (cancelled) return [];
      setServerConfig(config);
      if (!config.enabled) throw new Error("AI is disabled on this server. Its administrator can enable it in the dashboard.");
      const current = getAiPrefs();
      if (current.providerId === "selfhost_server" && (!current.model || !config.models.some((model) => model.id === current.model))) setAiPrefs({ model: config.defaultModel });
      return config.models;
    };
    void load()
      .then((models) => {
        if (cancelled) return;
        if (provider.id !== "selfhost_server") cache.set(scope, models);
        setCatalog({ scope, models });
        if (!models.length)
          setError(
            "The provider returned no models. Add a custom model ID below.",
          );
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider.id, provider.supportsModelList, scope, url, revision]);

  const models = useMemo(() => {
    const live = catalog?.scope === scope ? catalog.models : provider.id === "selfhost_server" ? undefined : cache.get(scope);
    const result = new Map<string, AiModelOption>();
    for (const model of live ?? provider.models) result.set(model.id, model);
    for (const id of provider.id === "selfhost_server" ? [] : prefs.customModels[provider.id] ?? [])
      result.set(id, { id, label: id });
    if (prefs.model.trim() && !result.has(prefs.model))
      result.set(prefs.model, {
        id: prefs.model,
        label: live ? `${prefs.model} (not listed by provider)` : prefs.model,
      });
    return [...result.values()];
  }, [catalog, scope, provider, prefs.customModels, prefs.model]);

  return { models, loading, error, refresh, serverConfig };
}
