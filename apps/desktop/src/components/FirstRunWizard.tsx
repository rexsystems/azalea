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
  onConnectSelfhostBrowser: (input: {
    label: string;
    base_url: string;
    web_url: string;
  }) => void | Promise<void>;
}

type Step = "choose" | "selfhost" | "selfhost-login";

export function FirstRunWizard({
  onDone,
  onConnectSelfhost,
  onConnectSelfhostBrowser,
}: FirstRunWizardProps) {
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
      const probe = await api.probeSelfhost({ baseUrl: base_url, webUrl: web_url });
      setResolvedBase(base_url);
      setResolvedWeb(probe.has_web_ui ? probe.web_url ?? web_url : null);
      setInstanceName(probe.instance_name);

      if (probe.has_web_ui && (probe.web_url || web_url)) {
        const web = probe.web_url ?? web_url;
        if (!web) throw new Error("Web UI URL missing.");
        await onConnectSelfhostBrowser({
          label: probe.instance_name,
          base_url,
          web_url: web,
        });
        await api.setAccountsOnboarded(true);
        onDone();
        return;
      }

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
      ? "Pick how you want to use Azalea."
      : step === "selfhost"
        ? "Enter your azalea-server URL."
        : `Sign in to ${instanceName ?? "your server"}.`;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--bg-base)" }}>
      <TitleBar />
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center text-center">
            <Logo size={40} />
            <h1
              className="mt-4 text-2xl font-semibold tracking-tight"
              style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}
            >
              Welcome to Azalea
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          </div>

          {step === "choose" ? (
            <div className="space-y-2">
              <Choice
                icon={<Globe size={18} />}
                title="Azalea Cloud"
                description="Sync through our hosted service."
                disabled={busy}
                onClick={() => void finishSimple("cloud")}
              />
              <Choice
                icon={<Server size={18} />}
                title="Self-hosted"
                description="Your own azalea-server instance."
                disabled={busy}
                onClick={() => setStep("selfhost")}
              />
              <Choice
                icon={<SquareTerminal size={18} />}
                title="Offline"
                description="Local only. No sync account."
                disabled={busy}
                onClick={() => void finishSimple("offline")}
              />
            </div>
          ) : step === "selfhost" ? (
            <div className="space-y-3">
              <Input
                label="Server URL"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://sync.example.com or http://IP:9482"
                autoFocus
              />
              {error && (
                <p className="text-sm" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setStep("choose");
                    setError(null);
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
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No web dashboard detected. Sign in with email and password.
              </p>
              {instanceName && (
                <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {instanceName}
                </p>
              )}
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim() && password) void finishSelfhost();
                }}
              />
              {error && (
                <p className="text-sm" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setStep("selfhost");
                    setError(null);
                    setPassword("");
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
        </div>
      </div>
    </div>
  );
}

function Choice({
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
      className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left disabled:opacity-50"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <span
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: "var(--text)" }}>
          {title}
        </span>
        <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
          {description}
        </span>
      </span>
    </button>
  );
}
