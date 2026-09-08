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
}

export function FirstRunWizard({ onDone }: FirstRunWizardProps) {
  const [step, setStep] = useState<"choose" | "selfhost">("choose");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (kind: "cloud" | "selfhost" | "offline") => {
    try {
      setBusy(true);
      setError(null);
      if (kind === "offline") {
        await api.setAccountsOnboarded(true);
        onDone();
        return;
      }
      if (kind === "cloud") {
        await api.addAccount({
          kind: "cloud",
          label: "Azalea Cloud",
          base_url: null,
          web_url: null,
        });
      } else {
        const { base_url, web_url } = resolveSelfHostUrls(serverUrl);
        await api.addAccount({
          kind: "selfhost",
          label: "Self-hosted",
          base_url,
          web_url,
        });
      }
      await api.setAccountsOnboarded(true);
      onDone();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  };

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
              {step === "choose"
                ? "How do you want to use sync?"
                : "Point the app at your sync server."}
            </p>
          </div>

          {step === "choose" ? (
            <div className="space-y-2">
              <ChoiceRow
                icon={<Globe size={18} />}
                title="Azalea Cloud"
                description="Hosted sync"
                disabled={busy}
                onClick={() => void finish("cloud")}
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
                onClick={() => void finish("offline")}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                label="Server URL"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://azalea.example.com"
                hint="Public domain uses /api. Local :8787 or a path ending in /api stays as-is."
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
                  onClick={() => void finish("selfhost")}
                >
                  Continue
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
