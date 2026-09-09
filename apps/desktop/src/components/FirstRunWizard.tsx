import { useState, type ReactNode } from "react";
import { ArrowLeft, Globe, Server, SquareTerminal } from "./icons";
import * as api from "../lib/api";
import { resolveSelfHostUrls } from "../lib/selfhostUrl";
import { Logo } from "./Logo";
import { TitleBar } from "./TitleBar";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface FirstRunWizardProps {
  onDone: () => void;
  onConnectSelfhost: (input: {
    label: string;
    base_url: string;
    web_url?: string | null;
    email: string;
    password: string;
  }) => void | Promise<void>;
}

type Step = "choose" | "selfhost" | "selfhost-login";

export function FirstRunWizard({ onDone, onConnectSelfhost }: FirstRunWizardProps) {
  const [step, setStep] = useState<Step>("choose");
  const [serverUrl, setServerUrl] = useState("");
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [resolvedBase, setResolvedBase] = useState<string | null>(null);
  const [resolvedWeb, setResolvedWeb] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finishSimple = async (kind: "cloud" | "offline") => {
    try {
      setBusy(true);
      setError(null);
      if (kind === "offline") {
        await api.setAccountsOnboarded(true);
        onDone();
        return;
      }
      await api.addAccount({
        kind: "cloud",
        label: "Azalea Cloud",
        base_url: null,
        web_url: null,
      });
      await api.setAccountsOnboarded(true);
      onDone();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  };

  const continueSelfhost = async () => {
    try {
      setBusy(true);
      setError(null);
      const { base_url, web_url } = resolveSelfHostUrls(serverUrl);
      const probe = await api.probeSelfhost(base_url);
      setResolvedBase(base_url);
      setResolvedWeb(web_url);
      setInstanceName(probe.instance_name);
      setStep("selfhost-login");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const finishSelfhost = async () => {
    if (!resolvedBase || !instanceName) return;
    try {
      setBusy(true);
      setError(null);
      await onConnectSelfhost({
        label: instanceName,
        base_url: resolvedBase,
        web_url: resolvedWeb,
        email: email.trim(),
        password,
      });
      await api.setAccountsOnboarded(true);
      onDone();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  };

  const subtitle =
    step === "choose"
      ? "How do you want to use sync?"
      : step === "selfhost"
        ? "Point the app at your sync server."
        : `Sign in to ${instanceName ?? "your server"}.`;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <TitleBar />

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-10">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 80% 55% at 50% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%)",
          }}
        />
        <div className="relative z-10 w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <Logo size={36} style={{ color: "var(--accent)" }} />
            <h1
              className="mt-5 text-2xl font-semibold tracking-tight"
              style={{ color: "var(--text)" }}
            >
              Welcome to Azalea
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          </div>

          {step === "choose" ? (
            <div className="space-y-2">
              <ChoiceRow
                icon={<Globe size={18} />}
                title="Azalea Cloud"
                description="Hosted sync"
                disabled={busy}
                onClick={() => void finishSimple("cloud")}
              />
              <ChoiceRow
                icon={<Server size={18} />}
                title="Self-hosted"
                description="Your own server"
                disabled={busy}
                onClick={() => setStep("selfhost")}
              />
              <ChoiceRow
                icon={<SquareTerminal size={18} />}
                title="Offline"
                description="No sync, local only"
                disabled={busy}
                onClick={() => void finishSimple("offline")}
              />
            </div>
          ) : step === "selfhost" ? (
            <div className="space-y-4">
              <Input
                label="Server URL"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://azalea.example.com"
                hint="Public domain uses /api. Local :9482 or a path ending in /api stays as-is."
              />
              <div className="flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep("choose");
                  }}
                >
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy || !serverUrl.trim()}
                  onClick={() => void continueSelfhost()}
                >
                  {busy ? "Checking…" : "Continue"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded-xl border px-3.5 py-3 text-left"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
              >
                <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Server
                </div>
                <div className="mt-1 text-sm font-medium" style={{ color: "var(--text)" }}>
                  {instanceName}
                </div>
                {resolvedBase && (
                  <div className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {resolvedBase.replace(/^https?:\/\//, "")}
                  </div>
                )}
              </div>
              <Input
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <div className="flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setPassword("");
                    setStep("selfhost");
                  }}
                >
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy || !email.trim() || !password}
                  onClick={() => void finishSelfhost()}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-center text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ChoiceRow({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="transition-ui flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3 text-left disabled:opacity-50"
      style={{ background: "var(--bg-panel)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-card-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-panel)";
      }}
    >
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" style={{ color: "var(--text)" }}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
          {description}
        </span>
      </span>
    </button>
  );
}
