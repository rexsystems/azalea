import { useCallback, useEffect, useState } from "react";
import {
  claudeCodeCommand,
  connectClaudeCode,
  getMcpStatus,
  jsonConfig,
  regenerateMcpToken,
  setMcpPrefs,
  type McpActivity,
  type McpPrefs,
  type McpStatus,
} from "../lib/mcp";
import { copyText } from "../lib/clipboard";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { SettingToggle } from "./ui/SettingToggle";

const REFRESH_MS = 3000;

const OUTCOME_LABEL: Record<McpActivity["outcome"], string> = {
  ok: "Done",
  error: "Failed",
  blocked: "Switch off",
  declined: "Declined",
};

function clean(err: unknown) {
  return String(err).replace(/^Error:\s*/, "");
}

function clock(seconds: number) {
  return new Date(seconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function McpSettingsSection() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getMcpStatus()
      .then(setStatus)
      .catch((err) => setError(clean(err)));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!status) {
    return error ? (
      <p className="break-words text-xs" style={{ color: "var(--danger)" }}>
        Could not read the AI tools setting: {error}
      </p>
    ) : null;
  }

  const { prefs } = status;

  const save = (next: McpPrefs) => {
    setSaving(true);
    setError(null);
    setMcpPrefs(next)
      .then(setStatus)
      .catch((err) => setError(clean(err)))
      .finally(() => setSaving(false));
  };

  const patch = (change: Partial<McpPrefs>) => save({ ...prefs, ...change });

  const copy = (label: string, text: string) => {
    void copyText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied((now) => (now === label ? null : now)), 1800);
    });
  };

  const commitPort = () => {
    if (portDraft === null) return;
    const port = Number(portDraft);
    setPortDraft(null);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError("Pick a port between 1024 and 65535.");
      return;
    }
    if (port !== prefs.port) patch({ port });
  };

  const problem = error ?? status.lastError;
  const url = status.url;
  const token = status.token;
  const commandsRisky = prefs.allowExec || prefs.allowFiles;

  return (
    <div className="space-y-4">
      <SettingToggle
        label="Let AI tools use Azalea"
        description="Starts a server on this computer that Claude Code, Codex, Cursor and other MCP clients can connect to. Nothing outside this machine can reach it, and every client needs the access token."
        checked={prefs.enabled}
        disabled={saving}
        onChange={(enabled) => patch({ enabled })}
      />

      {problem && (
        <p className="break-words text-xs" style={{ color: "var(--danger)" }}>
          {problem}
        </p>
      )}

      {prefs.enabled && (
        <>
          <div
            className="space-y-3 rounded-xl border p-4"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
          >
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: status.running ? "var(--accent)" : "var(--danger)" }}
              />
              {status.running ? "Running" : "Not running"}
            </div>

            {url && token && (
              <>
                <div className="min-w-0">
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Address
                  </div>
                  <div className="mt-0.5 break-all font-mono text-xs" style={{ color: "var(--text)" }}>
                    {url}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Access token
                  </div>
                  <div className="mt-0.5 break-all font-mono text-xs" style={{ color: "var(--text)" }}>
                    {showToken ? token : "•".repeat(24)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={connecting}
                    onClick={() => {
                      setConnecting(true);
                      setConnectNote(null);
                      connectClaudeCode()
                        .then(setConnectNote)
                        .catch((err) => setError(clean(err)))
                        .finally(() => setConnecting(false));
                    }}
                  >
                    {connecting ? "Connecting…" : "Connect to Claude Code"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy("claude", claudeCodeCommand(url, token))}
                  >
                    {copied === "claude" ? "Copied" : "Copy Claude Code command"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy("json", jsonConfig(url, token))}
                  >
                    {copied === "json" ? "Copied" : "Copy JSON config"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowToken((v) => !v)}>
                    {showToken ? "Hide token" : "Show token"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRegenerate(true)}>
                    New token
                  </Button>
                </div>
              </>
            )}

            {connectNote && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {connectNote}
              </p>
            )}

            <label className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Port
              <input
                inputMode="numeric"
                className="transition-ui no-number-spinners w-24 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                style={{
                  background: "var(--bg-input)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text)",
                }}
                value={portDraft ?? String(prefs.port)}
                onChange={(event) => setPortDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
                onBlur={commitPort}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                aria-label="Port"
              />
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              What they can do
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Reading is always allowed: hosts, groups, snippets, and the public half of your keys.
              Private keys and passwords are never sent. Everything below is off until you turn it
              on.
            </p>
          </div>

          <SettingToggle
            label="SSH keys"
            description="Create keys, delete keys, and add a key to a server's authorized_keys."
            checked={prefs.allowKeys}
            disabled={saving}
            onChange={(allowKeys) => patch({ allowKeys })}
          />
          <SettingToggle
            label="Hosts"
            description="Add, edit and remove saved hosts."
            checked={prefs.allowHosts}
            disabled={saving}
            onChange={(allowHosts) => patch({ allowHosts })}
          />
          <SettingToggle
            label="Run commands"
            description="Run shell commands on a host. Only works for hosts whose server key you already trusted."
            checked={prefs.allowExec}
            disabled={saving}
            onChange={(allowExec) => patch({ allowExec })}
          />
          <SettingToggle
            label="Files"
            description="List, read and write files on a host over SFTP."
            checked={prefs.allowFiles}
            disabled={saving}
            onChange={(allowFiles) => patch({ allowFiles })}
          />
          <SettingToggle
            label="Ask me before changes"
            description="A dialog in Azalea shows each command, file write and key install, and waits for you. Deleting a key or host always asks."
            checked={prefs.confirmActions}
            disabled={saving}
            onChange={(confirmActions) => patch({ confirmActions })}
          />
          {!prefs.confirmActions && commandsRisky && (
            <p className="text-xs leading-relaxed" style={{ color: "var(--danger)" }}>
              With the dialog off, a connected AI tool can run commands and overwrite files on your
              servers without asking you first.
            </p>
          )}

          <div className="space-y-2">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Recent activity
            </div>
            {status.activity.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Nothing yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {status.activity.slice(0, 8).map((item, index) => (
                  <li
                    key={`${item.at}-${index}`}
                    className="flex flex-wrap items-baseline gap-x-3 text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {clock(item.at)}
                    </span>
                    <span className="font-mono">{item.tool}</span>
                    {item.target && <span className="break-all">{item.target}</span>}
                    <span
                      style={{
                        color: item.outcome === "ok" ? "var(--text-muted)" : "var(--danger)",
                      }}
                    >
                      {OUTCOME_LABEL[item.outcome]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        title="Create a new token?"
        message="Every connected AI tool stops working until you give it the new token."
        confirmLabel="Create token"
        danger
        onConfirm={() => {
          setConfirmRegenerate(false);
          setSaving(true);
          regenerateMcpToken()
            .then(setStatus)
            .catch((err) => setError(clean(err)))
            .finally(() => setSaving(false));
        }}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </div>
  );
}
