import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  KeyRound,
  Loader2,
  Network,
  SquareTerminal,
  X,
  type AppIcon,
} from "./icons";
import { hostMarkAccent } from "./HostMark";
import { HostOsIcon } from "./HostOsIcon";

interface ConnectionScreenProps {
  hostName: string;
  username: string;
  hostname: string;
  port: number;
  status: "connecting" | "connected" | "error";
  error?: string;
  logs: string[];
  markSeed?: string;
  osId?: string | null;
  onExitComplete?: () => void;
}

type StepState = "pending" | "active" | "done" | "failed";

interface Step {
  id: string;
  label: string;
  description: string;
  state: StepState;
  Icon: AppIcon;
}

function buildSteps(
  logs: string[],
  status: "connecting" | "connected" | "error",
): Step[] {
  if (status === "connected") {
    return [
      { id: "reach", label: "Reach", description: "TCP open", Icon: Network, state: "done" },
      { id: "auth", label: "Auth", description: "Credentials", Icon: KeyRound, state: "done" },
      { id: "shell", label: "Shell", description: "Session", Icon: SquareTerminal, state: "done" },
    ];
  }

  const joined = logs.join("\n").toLowerCase();
  const has = (needle: string) => joined.includes(needle.toLowerCase());

  const tcp = has("tcp connection established") || has("authenticating");
  const authStarted = has("authenticating");
  const authOk =
    has("authentication successful") || has("opening shell") || has("shell ready");
  const shellStarted = has("opening shell") || has("shell ready");
  const shellOk = has("shell ready");
  const failed = status === "error";

  const mark = (
    done: boolean,
    activeWhen: boolean,
    failHere: boolean,
  ): StepState => {
    if (done) return "done";
    if (failed && failHere) return "failed";
    if (activeWhen && !failed) return "active";
    if (failed) return "pending";
    return "pending";
  };

  return [
    {
      id: "reach",
      label: "Reach",
      description: "TCP open",
      Icon: Network,
      state: mark(tcp, true, !tcp),
    },
    {
      id: "auth",
      label: "Auth",
      description: "Credentials",
      Icon: KeyRound,
      state: mark(authOk, authStarted || tcp, authStarted && !authOk),
    },
    {
      id: "shell",
      label: "Shell",
      description: "Session",
      Icon: SquareTerminal,
      state: mark(shellOk, shellStarted || authOk, shellStarted && !shellOk),
    },
  ];
}

function StepNode({ state, Icon }: { state: StepState; Icon: AppIcon }) {
  if (state === "done") {
    return (
      <span className="connect-node done">
        <Check size={18} strokeWidth={2.75} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="connect-node failed">
        <X size={18} strokeWidth={2.75} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="connect-node active">
        <Loader2 size={18} strokeWidth={2.25} className="animate-spin" />
      </span>
    );
  }
  return (
    <span className="connect-node pending">
      <Icon size={18} strokeWidth={2} />
    </span>
  );
}

export function ConnectionScreen({
  hostName,
  username,
  hostname,
  port,
  status,
  error,
  logs,
  markSeed,
  osId,
  onExitComplete,
}: ConnectionScreenProps) {
  const seed = markSeed || `${username}@${hostname}:${port}` || hostName;
  const accent = hostMarkAccent(seed);
  const portSuffix = port === 22 ? "" : `:${port}`;
  const steps = useMemo(() => buildSteps(logs, status), [logs, status]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const visibleLogs = logs.slice(-8);
  const latestLog = visibleLogs[visibleLogs.length - 1];
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitStarted = useRef(false);
  const [shownDone, setShownDone] = useState(0);

  const targetDone = useMemo(() => {
    if (status === "connected") return steps.length;
    if (status === "error") {
      const failedAt = steps.findIndex((s) => s.state === "failed");
      if (failedAt >= 0) return failedAt;
      return steps.filter((s) => s.state === "done").length;
    }
    return steps.filter((s) => s.state === "done").length;
  }, [steps, status]);

  const visualSteps = useMemo(() => {
    return steps.map((step, index) => {
      if (status === "error" && step.state === "failed" && index === targetDone) {
        return { ...step, state: "failed" as const };
      }
      if (index < shownDone) return { ...step, state: "done" as const };
      if (
        index === shownDone &&
        shownDone < steps.length &&
        !(status === "error" && index === targetDone)
      ) {
        return { ...step, state: "active" as const };
      }
      return { ...step, state: "pending" as const };
    });
  }, [steps, shownDone, status, targetDone]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  useEffect(() => {
    if (shownDone >= targetDone) return;
    const id = window.setTimeout(() => {
      setShownDone((n) => Math.min(n + 1, targetDone));
    }, 260);
    return () => window.clearTimeout(id);
  }, [shownDone, targetDone]);

  useEffect(() => {
    if (status !== "connected" || exitStarted.current) return;
    if (shownDone < steps.length) return;
    exitStarted.current = true;

    const hold = window.setTimeout(() => setExiting(true), 320);
    const done = window.setTimeout(() => onExitComplete?.(), 320 + 360);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [status, shownDone, steps.length, onExitComplete]);

  const activeVisual = visualSteps.find((s) => s.state === "active");
  const allVisualDone = shownDone >= steps.length;
  const headline =
    status === "error"
      ? "Could not connect"
      : status === "connected" && allVisualDone
        ? "Connected"
        : activeVisual?.label === "Reach"
          ? "Reaching host"
          : activeVisual?.label === "Auth"
            ? "Authenticating"
            : activeVisual?.label === "Shell"
              ? "Opening shell"
              : "Connecting";

  const headlineTone =
    status === "error"
      ? "#f87171"
      : status === "connected" && allVisualDone
        ? "#86efac"
        : "var(--text-secondary)";

  return (
    <div
      className={`connect-screen absolute inset-0 z-10 flex flex-col items-center justify-center px-5 py-8 sm:px-8 ${
        entered ? "entered" : ""
      } ${exiting ? "exiting" : ""}`}
    >
      <div
        className="connect-wash"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 28%, ${accent}28 0%, transparent 68%)`,
        }}
        aria-hidden
      />

      <div className="connect-stage relative z-10 flex w-full max-w-xl flex-col items-center text-center">
        <div className="connect-avatar mb-6 sm:mb-7">
          <HostOsIcon osId={osId} seed={seed} size={88} rounded={22} />
        </div>

        <h2
          className="max-w-full truncate px-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
        >
          {hostName}
        </h2>
        <p
          className="mt-2 max-w-full truncate px-2 font-mono text-sm sm:text-[15px]"
          style={{ color: "var(--text-muted)" }}
        >
          {username}@{hostname}
          {portSuffix}
        </p>

        <p className="mt-6 text-base font-medium sm:text-lg" style={{ color: headlineTone }}>
          {status === "error"
            ? (error ?? headline)
            : status === "connected" && allVisualDone
              ? headline
              : `${headline}…`}
        </p>

        <nav className="connect-stepper mt-8 w-full px-1 sm:mt-10 sm:px-2" aria-label="Connection progress">
          <ol className="flex w-full items-start">
            {visualSteps.map((step, index) => (
              <li
                key={step.id}
                className="connect-step-col relative flex min-w-0 flex-1 flex-col items-center"
              >
                {index < visualSteps.length - 1 && (
                  <div className="connect-step-separator" aria-hidden>
                    <div
                      className={`connect-step-fill ${
                        step.state === "done" ? "filled" : ""
                      }`}
                    />
                  </div>
                )}

                <StepNode state={step.state} Icon={step.Icon} />

                <div className="mt-3 flex flex-col items-center gap-0.5 px-1">
                  <span
                    className={`connect-step-label text-sm font-semibold sm:text-[15px] ${step.state}`}
                  >
                    {step.label}
                  </span>
                  <span
                    className="hidden text-[11px] sm:block"
                    style={{
                      color:
                        step.state === "active"
                          ? "var(--text-secondary)"
                          : step.state === "done"
                            ? "color-mix(in srgb, #86efac 70%, var(--text-muted))"
                            : "var(--text-muted)",
                    }}
                  >
                    {step.description}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </nav>

        <div
          className="connect-session mt-8 w-full rounded-2xl border px-4 py-4 text-left sm:mt-10 sm:px-5 sm:py-5"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--terminal-bg)",
          }}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span
              className="text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "var(--text-muted)" }}
            >
              Session
            </span>
            {(status === "connecting" || (status === "connected" && !allVisualDone)) && (
              <span className="connect-live-dot" aria-hidden />
            )}
          </div>
          <div
            className="min-h-[7.5rem] font-mono text-[12px] leading-relaxed sm:min-h-[8.5rem] sm:text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {status === "error" && error ? (
              <span className="break-words whitespace-pre-wrap" style={{ color: "#fca5a5" }}>
                {error}
              </span>
            ) : status === "connected" && allVisualDone ? (
              <span style={{ color: "#86efac" }}>Shell ready</span>
            ) : latestLog ? (
              visibleLogs.map((line, i) => (
                <div
                  key={`${logs.length - visibleLogs.length + i}-${line}`}
                  className="break-words py-0.5"
                  style={{
                    color: i === visibleLogs.length - 1 ? "var(--text)" : "var(--text-muted)",
                    opacity: i === visibleLogs.length - 1 ? 1 : 0.72,
                  }}
                >
                  {line}
                </div>
              ))
            ) : (
              <span style={{ color: "var(--text-muted)" }}>Waiting for handshake…</span>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
