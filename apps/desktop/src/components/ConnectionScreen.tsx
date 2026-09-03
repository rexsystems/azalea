import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  KeyRound,
  Network,
  SquareTerminal,
  X,
} from "lucide-react";
import { getHostIconColor } from "../lib/theme";
import { getHostInitials } from "../lib/utils";

interface ConnectionScreenProps {
  hostName: string;
  username: string;
  hostname: string;
  port: number;
  status: "connecting" | "connected" | "error";
  error?: string;
  logs: string[];
  onExitComplete?: () => void;
}

type StepState = "pending" | "active" | "done" | "failed";

interface Step {
  id: string;
  label: string;
  state: StepState;
  Icon: typeof Network;
}

function buildSteps(
  logs: string[],
  status: "connecting" | "connected" | "error",
): Step[] {
  if (status === "connected") {
    return [
      { id: "reach", label: "Reach", Icon: Network, state: "done" },
      { id: "auth", label: "Auth", Icon: KeyRound, state: "done" },
      { id: "shell", label: "Shell", Icon: SquareTerminal, state: "done" },
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
      Icon: Network,
      state: mark(tcp, true, !tcp),
    },
    {
      id: "auth",
      label: "Auth",
      Icon: KeyRound,
      state: mark(authOk, authStarted || tcp, authStarted && !authOk),
    },
    {
      id: "shell",
      label: "Shell",
      Icon: SquareTerminal,
      state: mark(shellOk, shellStarted || authOk, shellStarted && !shellOk),
    },
  ];
}

function StepNode({ state, Icon }: { state: StepState; Icon: typeof Network }) {
  if (state === "done") {
    return (
      <span className="connect-node done">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="connect-node failed">
        <X size={12} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className={`connect-node ${state === "active" ? "active" : "pending"}`}>
      <Icon size={12} strokeWidth={state === "active" ? 2.25 : 2} />
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
  onExitComplete,
}: ConnectionScreenProps) {
  const iconColor = getHostIconColor(hostName);
  const portSuffix = port === 22 ? "" : `:${port}`;
  const steps = useMemo(() => buildSteps(logs, status), [logs, status]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const visibleLogs = logs.slice(-5);
  const latestLog = visibleLogs[visibleLogs.length - 1];
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitStarted = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  useEffect(() => {
    if (status !== "connected" || exitStarted.current) return;
    exitStarted.current = true;

    const hold = window.setTimeout(() => setExiting(true), 420);
    const done = window.setTimeout(() => onExitComplete?.(), 420 + 380);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [status, onExitComplete]);

  const headline =
    status === "error"
      ? "Could not connect"
      : status === "connected"
        ? "Connected"
        : steps.find((s) => s.state === "active")?.label === "Reach"
          ? "Reaching host"
          : steps.find((s) => s.state === "active")?.label === "Auth"
            ? "Authenticating"
            : steps.find((s) => s.state === "active")?.label === "Shell"
              ? "Opening shell"
              : "Connecting";

  return (
    <div
      className={`connect-screen absolute inset-0 z-10 flex flex-col items-center justify-center px-6 ${
        entered ? "entered" : ""
      } ${exiting ? "exiting" : ""}`}
    >
      <div
        className="connect-wash"
        style={{
          background: `radial-gradient(ellipse 70% 55% at 50% 35%, ${iconColor}22 0%, transparent 70%)`,
        }}
        aria-hidden
      />

      <div className="connect-stage relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        <div
          className="connect-avatar mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-semibold text-white"
          style={{ background: iconColor }}
        >
          {getHostInitials(hostName)}
        </div>

        <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
          {hostName}
        </h2>
        <p className="mt-1.5 font-mono text-[13px]" style={{ color: "var(--text-muted)" }}>
          {username}@{hostname}
          {portSuffix}
        </p>

        <p
          className="mt-5 text-sm font-medium"
          style={{
            color:
              status === "error"
                ? "#f87171"
                : status === "connected"
                  ? "#86efac"
                  : "var(--text-secondary)",
          }}
        >
          {status === "error"
            ? (error ?? headline)
            : status === "connected"
              ? headline
              : `${headline}…`}
        </p>

        <div className="mt-6 w-full">
          <div className="flex items-start justify-between gap-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className="connect-step-col flex min-w-0 flex-1 flex-col items-center gap-2"
                style={{ transitionDelay: `${80 + index * 70}ms` }}
              >
                <div className="flex w-full items-center">
                  {index > 0 && (
                    <div
                      className={`connect-step-line h-px flex-1 ${
                        steps[index - 1].state === "done" ? "filled" : ""
                      }`}
                    />
                  )}
                  <StepNode state={step.state} Icon={step.Icon} />
                  {index < steps.length - 1 && (
                    <div
                      className={`connect-step-line h-px flex-1 ${
                        step.state === "done" ? "filled" : ""
                      }`}
                    />
                  )}
                </div>
                <span
                  className="text-[11px] font-medium"
                  style={{
                    color:
                      step.state === "active"
                        ? "var(--text)"
                        : step.state === "done"
                          ? "#86efac"
                          : step.state === "failed"
                            ? "#fca5a5"
                            : "var(--text-muted)",
                  }}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="connect-session mt-7 w-full rounded-xl border px-3.5 py-3 text-left"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--terminal-bg)",
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="text-[10px] font-medium uppercase tracking-[0.12em]"
              style={{ color: "var(--text-muted)" }}
            >
              Session
            </span>
            {status === "connecting" && <span className="connect-live-dot" aria-hidden />}
          </div>
          <div
            className="font-mono text-[11px] leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            {status === "error" && error ? (
              <span style={{ color: "#fca5a5" }}>{error}</span>
            ) : status === "connected" ? (
              <span style={{ color: "#86efac" }}>Shell ready</span>
            ) : latestLog ? (
              visibleLogs.map((line, i) => (
                <div
                  key={`${logs.length - visibleLogs.length + i}-${line}`}
                  className="truncate py-px"
                  style={{
                    color: i === visibleLogs.length - 1 ? "var(--text)" : "var(--text-muted)",
                    opacity: i === visibleLogs.length - 1 ? 1 : 0.75,
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
