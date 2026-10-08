"use client";

import { useEffect, useState } from "react";
import { ApiRequestError, getAuthConfig, TURNSTILE_SITE_KEY, type AuthConfig } from "./azalea-api";

export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getAuthConfig().then((value) => { if (!cancelled) setConfig(value); }).catch((err) => {
      if (cancelled) return;
      if (err instanceof ApiRequestError && err.status === 404) setConfig({ signup_enabled: true, captcha_provider: TURNSTILE_SITE_KEY ? "turnstile" : "none", captcha_site_key: TURNSTILE_SITE_KEY });
      else setError(err instanceof Error ? err.message : String(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { config, loading, error, siteKey: config?.captcha_site_key ?? "" };
}
