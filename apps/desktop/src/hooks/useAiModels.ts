import { useCallback, useEffect, useMemo, useState } from "react";
import { aiListModels } from "../lib/api";
import {
  getProvider,
  resolveProviderBaseUrl,
  type AiPrefs,
  type AiModelOption,
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
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(false);
    if (!provider.supportsModelList || !url) return;
    setLoading(true);
    void aiListModels(provider.id, url)
      .then((models) => {
        if (cancelled) return;
        cache.set(scope, models);
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
    const live = catalog?.scope === scope ? catalog.models : cache.get(scope);
    const result = new Map<string, AiModelOption>();
    for (const model of live ?? provider.models) result.set(model.id, model);
    for (const id of prefs.customModels[provider.id] ?? [])
      result.set(id, { id, label: id });
    if (prefs.model.trim() && !result.has(prefs.model))
      result.set(prefs.model, {
        id: prefs.model,
        label: live ? `${prefs.model} (not listed by provider)` : prefs.model,
      });
    return [...result.values()];
  }, [catalog, scope, provider, prefs.customModels, prefs.model]);

  return { models, loading, error, refresh };
}
