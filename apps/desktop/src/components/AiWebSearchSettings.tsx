import { useEffect, useRef, useState } from "react";
import type { AiPrefs, AiWebSource } from "../lib/ai";
import * as api from "../lib/api";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { SettingToggle } from "./ui/SettingToggle";

export function AiWebSearchSettings({
  prefs,
  onChange,
}: {
  prefs: AiPrefs;
  onChange: (patch: Partial<AiPrefs>) => void;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [keyPresent, setKeyPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AiWebSource[]>([]);
  const requestRef = useRef<string | null>(null);
  const keyId = `web-search-${prefs.webSearchProvider}`;
  const name =
    prefs.webSearchProvider === "mwmbl"
      ? "Mwmbl"
      : prefs.webSearchProvider === "duckduckgo"
        ? "DuckDuckGo"
        : prefs.webSearchProvider === "tavily"
          ? "Tavily"
          : prefs.webSearchProvider === "brave"
            ? "Brave"
            : "SearXNG";
  useEffect(() => {
    let cancelled = false;
    setKeyDraft("");
    setKeyPresent(false);
    setStatus(null);
    setError(null);
    setResults([]);
    if (!["mwmbl", "searxng", "duckduckgo"].includes(prefs.webSearchProvider))
      void api
        .aiApiKeyPresent(keyId)
        .then((present) => {
          if (!cancelled) setKeyPresent(present);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [keyId, prefs.webSearchProvider]);
  useEffect(
    () => () => {
      if (requestRef.current) void api.aiChatCancel(requestRef.current);
    },
    [],
  );
  const updateKey = async (remove = false) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (remove) {
        await api.aiClearApiKey(keyId);
        setKeyPresent(false);
      } else {
        await api.aiSetApiKey(keyId, keyDraft.trim());
        setKeyPresent(true);
        onChange({ webSearchEnabled: true });
      }
      setKeyDraft("");
      setStatus(
        remove
          ? "Search key removed."
          : "Search key saved. Web search is enabled.",
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  const testSearch = async () => {
    const requestId = `search-test-${crypto.randomUUID()}`;
    requestRef.current = requestId;
    setBusy(true);
    setError(null);
    setResults([]);
    setStatus("Searching the web…");
    try {
      const sources = await api.aiWebSearch(
        requestId,
        prefs.webSearchProvider,
        "Tauri",
        prefs.webSearchUrl,
      );
      setResults(sources);
      setStatus(`Connected · ${sources.length} sources returned.`);
    } catch (err) {
      setStatus(null);
      setError(String(err));
    } finally {
      requestRef.current = null;
      setBusy(false);
    }
  };
  const fieldStyle = {
    background: "var(--bg-input)",
    borderColor: "var(--border-subtle)",
    color: "var(--text)",
  };
  return (
    <div
      className="space-y-4 rounded-xl border p-4"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--bg-card)",
      }}
    >
      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
        Web search
      </div>
      <SettingToggle
        label="Allow web search"
        description="Ask and Agent can search the web and cite sources. Queries go to the search provider you select."
        checked={prefs.webSearchEnabled}
        onChange={(webSearchEnabled) => onChange({ webSearchEnabled })}
      />
      <Select
        label="Search provider"
        value={prefs.webSearchProvider}
        disabled={busy}
        options={[
          { value: "mwmbl", label: "Mwmbl (no key required)" },
          { value: "duckduckgo", label: "DuckDuckGo (no key required)" },
          { value: "tavily", label: "Tavily" },
          { value: "brave", label: "Brave Search" },
          { value: "searxng", label: "SearXNG (your own instance)" },
        ]}
        onChange={(provider) =>
          onChange({
            webSearchProvider: provider as AiPrefs["webSearchProvider"],
          })
        }
      />
      {prefs.webSearchProvider === "mwmbl" ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Works without a key or account. Mwmbl uses its own public index, with
          less coverage than larger engines.
        </p>
      ) : prefs.webSearchProvider === "duckduckgo" ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Works without an API key. Uses DuckDuckGo public results; temporary
          limits or browser verification show up as errors.
        </p>
      ) : prefs.webSearchProvider === "searxng" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Instance URL · JSON search output must be enabled
          </span>
          <input
            value={prefs.webSearchUrl}
            disabled={busy}
            onChange={(e) => onChange({ webSearchUrl: e.target.value })}
            placeholder="https://search.example.com"
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={fieldStyle}
          />
        </label>
      ) : (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {keyPresent
              ? `${name} search key is saved. Leave this blank to use it.`
              : `Use a ${name} search API key. This is separate from your AI model key and stays in the OS keychain.`}
          </p>
          <input
            type="password"
            autoComplete="off"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={
              keyPresent ? "Replace saved search key" : `${name} search API key`
            }
            className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
            style={fieldStyle}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !keyDraft.trim()}
              onClick={() => void updateKey()}
            >
              Save search key
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !keyPresent}
              onClick={() => void updateKey(true)}
            >
              Clear key
            </Button>
          </div>
        </div>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={
          busy ||
          (["mwmbl", "duckduckgo"].includes(prefs.webSearchProvider)
            ? false
            : prefs.webSearchProvider === "searxng"
              ? !prefs.webSearchUrl.trim()
              : !keyPresent)
        }
        onClick={() => void testSearch()}
      >
        {busy ? "Working…" : "Test web search"}
      </Button>
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
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((source) => (
            <a
              key={source.url}
              className="block truncate text-xs underline"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              {source.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
