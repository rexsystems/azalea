import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AccountKind, AccountRecord, SyncStatus } from "../lib/api";
import * as api from "../lib/api";
import { maskEmail } from "../lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronUp,
  Globe,
  Plus,
  Server,
  SquareTerminal,
  Trash2,
  User,
} from "./icons";
import { PlanBadge } from "./PlanBadge";
import { UserAvatar } from "./UserAvatar";
import { resolveSelfHostUrls } from "../lib/selfhostUrl";

interface AccountSwitcherProps {
  accounts: AccountRecord[];
  active: AccountRecord | null;
  syncStatus?: SyncStatus | null;
  onSwitch: (id: string) => void | Promise<void>;
  onAdd: (input: {
    kind: AccountKind;
    label: string;
    base_url?: string | null;
    web_url?: string | null;
  }) => void | Promise<void>;
  onConnectSelfhost: (input: {
    label: string;
    base_url: string;
    web_url?: string | null;
    email: string;
    password: string;
  }) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onManage: () => void;
  onSignIn?: () => void;
  onPasswordLogin?: (email: string, password: string) => void | Promise<void>;
  compact?: boolean;
}

type AddStep = "menu" | "choose" | "selfhost" | "selfhost-login" | "reauth";

function kindIcon(kind: AccountKind): ReactNode {
  if (kind === "selfhost") return <Server size={14} />;
  if (kind === "cloud") return <Globe size={14} />;
  return <SquareTerminal size={14} />;
}

function kindLabel(kind: AccountKind): string {
  if (kind === "selfhost") return "Self-hosted";
  if (kind === "cloud") return "Cloud";
  return "Offline";
}

const fieldClass =
  "transition-ui w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-[var(--accent)] placeholder:opacity-50";
const fieldStyle: CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border-subtle)",
  color: "var(--text)",
};

export function AccountSwitcher({
  accounts,
  active,
  syncStatus,
  onSwitch,
  onAdd,
  onConnectSelfhost,
  onRemove,
  onManage,
  onSignIn,
  onPasswordLogin,
  compact = false,
}: AccountSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddStep>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [resolvedBase, setResolvedBase] = useState<string | null>(null);
  const [resolvedWeb, setResolvedWeb] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [panelPos, setPanelPos] = useState<{
    left: number;
    bottom?: number;
    top?: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const authDisconnected = Boolean(syncStatus?.auth_disconnected);
  const displayEmail = syncStatus?.email ?? active?.email ?? null;

  const close = () => {
    setOpen(false);
    setStep("menu");
    setError(null);
    setPassword("");
  };

  const resetSelfhostForm = () => {
    setServerUrl("");
    setInstanceName(null);
    setResolvedBase(null);
    setResolvedWeb(null);
    setEmail("");
    setPassword("");
  };

  const placePanel = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, compact ? 300 : 280);
    if (compact) {
      setPanelPos({
        left: Math.min(rect.right - width, window.innerWidth - width - 8),
        top: rect.bottom + 8,
        width,
      });
    } else {
      setPanelPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
        width,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    placePanel();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const panel = document.getElementById("azalea-account-switcher-panel");
      if (panel?.contains(target)) return;
      close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onResize = () => placePanel();
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onResize);
    };
  }, [open, compact, step]);

  const title = displayEmail
    ? maskEmail(displayEmail)
    : active?.label ?? "Local";
  const subtitle = active ? kindLabel(active.kind) : "Account";

  const addSimpleAccount = async (kind: "cloud" | "offline") => {
    try {
      setBusy(true);
      setError(null);
      if (kind === "cloud") {
        await onAdd({ kind: "cloud", label: "Azalea Cloud" });
      } else {
        await onAdd({ kind: "offline", label: "Offline" });
      }
      close();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
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
      resetSelfhostForm();
      close();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const finishReauth = async () => {
    try {
      setBusy(true);
      setError(null);
      if (active?.kind === "selfhost") {
        if (onPasswordLogin) {
          await onPasswordLogin(email.trim() || displayEmail || "", password);
        } else {
          await api.syncPasswordLogin(email.trim() || displayEmail || "", password);
        }
      } else if (onSignIn) {
        onSignIn();
        close();
        return;
      }
      setPassword("");
      close();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const warningIcon = authDisconnected ? (
    <span title="Account disconnected" style={{ color: "var(--warning, #d97706)" }}>
      <AlertTriangle size={compact ? 14 : 15} />
    </span>
  ) : null;

  const trigger = compact ? (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => {
        if (open) close();
        else {
          setOpen(true);
          setStep("menu");
        }
      }}
      className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-ui hover-subtle"
      aria-label="Switch account"
      aria-expanded={open}
    >
      <UserAvatar email={displayEmail ?? undefined} size={28} />
      {warningIcon}
      {syncStatus?.logged_in ? (
        <PlanBadge plan={syncStatus.plan} />
      ) : (
        <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {authDisconnected ? "Disconnected" : "Accounts"}
        </span>
      )}
    </button>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => {
        if (open) close();
        else {
          setOpen(true);
          setStep("menu");
        }
      }}
      className="mb-2 flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-ui hover-subtle"
      aria-label="Switch account"
      aria-expanded={open}
    >
      <UserAvatar email={displayEmail ?? undefined} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
            {title}
          </div>
          {warningIcon}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {syncStatus?.logged_in ? (
            <PlanBadge plan={syncStatus.plan} />
          ) : (
            <span className="truncate text-[10px]" style={{ color: authDisconnected ? "var(--warning, #d97706)" : "var(--text-muted)" }}>
              {authDisconnected ? "Disconnected" : subtitle}
            </span>
          )}
        </div>
      </div>
      <ChevronUp
        size={14}
        style={{
          color: "var(--text-muted)",
          transform: open ? undefined : "rotate(180deg)",
          transition: "transform 120ms ease",
        }}
      />
    </button>
  );

  const panel =
    open && panelPos
      ? createPortal(
          <div
            id="azalea-account-switcher-panel"
            className="animate-menu-in fixed z-[100] overflow-hidden rounded-xl border shadow-lg"
            style={{
              left: panelPos.left,
              top: panelPos.top,
              bottom: panelPos.bottom,
              width: panelPos.width,
              background: "var(--bg-panel)",
              borderColor: "var(--border)",
            }}
          >
            {step === "choose" ? (
              <div className="p-2">
                <div className="mb-1.5 flex items-center gap-1 px-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("menu");
                      setError(null);
                    }}
                    className="rounded-md p-1 transition-ui hover-subtle"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Back"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    Add account
                  </span>
                </div>
                <div className="space-y-1">
                  <ChoiceRow
                    icon={<Globe size={15} />}
                    title="Azalea Cloud"
                    description="Hosted sync"
                    disabled={busy}
                    onClick={() => void addSimpleAccount("cloud")}
                  />
                  <ChoiceRow
                    icon={<Server size={15} />}
                    title="Self-hosted"
                    description="Your own server"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      resetSelfhostForm();
                      setStep("selfhost");
                    }}
                  />
                  <ChoiceRow
                    icon={<SquareTerminal size={15} />}
                    title="Offline"
                    description="Local only"
                    disabled={busy}
                    onClick={() => void addSimpleAccount("offline")}
                  />
                </div>
                {error && (
                  <p className="mt-2 px-1.5 text-[11px]" style={{ color: "var(--danger)" }}>
                    {error}
                  </p>
                )}
              </div>
            ) : step === "selfhost" ? (
              <div className="space-y-2.5 p-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("choose");
                      setError(null);
                    }}
                    className="rounded-md p-1 transition-ui hover-subtle"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Back"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    Self-hosted
                  </span>
                </div>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                    Server URL
                  </span>
                  <input
                    className={fieldClass}
                    style={fieldStyle}
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://azalea.example.com"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && serverUrl.trim()) void continueSelfhost();
                    }}
                  />
                  <span className="block text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Public domain uses /api. Local :9482 or …/api stays as-is.
                  </span>
                </label>
                {error && (
                  <p className="text-[11px]" style={{ color: "var(--danger)" }}>
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy || !serverUrl.trim()}
                  onClick={() => void continueSelfhost()}
                  className="home-action-primary transition-ui w-full rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "Checking…" : "Continue"}
                </button>
              </div>
            ) : step === "selfhost-login" ? (
              <div className="space-y-2.5 p-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("selfhost");
                      setError(null);
                      setPassword("");
                    }}
                    className="rounded-md p-1 transition-ui hover-subtle"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Back"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    Sign in
                  </span>
                </div>
                <div
                  className="rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--bg-input)" }}
                >
                  <div className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                    Server
                  </div>
                  <div className="mt-0.5 truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                    {instanceName}
                  </div>
                  {resolvedBase && (
                    <div className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {resolvedBase.replace(/^https?:\/\//, "")}
                    </div>
                  )}
                </div>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                    Email
                  </span>
                  <input
                    className={fieldClass}
                    style={fieldStyle}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    autoFocus
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                    Password
                  </span>
                  <input
                    className={fieldClass}
                    style={fieldStyle}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && email.trim() && password) void finishSelfhost();
                    }}
                  />
                </label>
                {error && (
                  <p className="text-[11px]" style={{ color: "var(--danger)" }}>
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy || !email.trim() || !password}
                  onClick={() => void finishSelfhost()}
                  className="home-action-primary transition-ui w-full rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            ) : step === "reauth" ? (
              <div className="space-y-2.5 p-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("menu");
                      setError(null);
                      setPassword("");
                    }}
                    className="rounded-md p-1 transition-ui hover-subtle"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Back"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    Reconnect
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Account on {active?.label ?? "this profile"} was disconnected. Sign in again.
                </p>
                {active?.kind === "selfhost" ? (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                        Email
                      </span>
                      <input
                        className={fieldClass}
                        style={fieldStyle}
                        type="email"
                        value={email || displayEmail || ""}
                        onChange={(e) => setEmail(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                        Password
                      </span>
                      <input
                        className={fieldClass}
                        style={fieldStyle}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && password) void finishReauth();
                        }}
                      />
                    </label>
                    {error && (
                      <p className="text-[11px]" style={{ color: "var(--danger)" }}>
                        {error}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || !(email.trim() || displayEmail) || !password}
                      onClick={() => void finishReauth()}
                      className="home-action-primary transition-ui w-full rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                    >
                      {busy ? "Reconnecting…" : "Reconnect"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      close();
                      onSignIn?.();
                    }}
                    className="home-action-primary transition-ui w-full rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                  >
                    Sign in with browser
                  </button>
                )}
              </div>
            ) : (
              <>
                {authDisconnected && (
                  <div
                    className="flex items-start gap-2 border-b px-3 py-2.5"
                    style={{
                      borderColor: "var(--border-subtle)",
                      background: "color-mix(in srgb, #d97706 12%, transparent)",
                    }}
                  >
                    <AlertTriangle size={14} style={{ color: "#d97706", marginTop: 1 }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug" style={{ color: "var(--text)" }}>
                        Account on {active?.label ?? "this profile"} was disconnected. Reconnect
                        again.
                      </p>
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-medium underline-offset-2 hover:underline"
                        style={{ color: "#d97706" }}
                        onClick={() => {
                          setError(null);
                          setEmail(displayEmail ?? "");
                          setPassword("");
                          setStep("reauth");
                        }}
                      >
                        Reconnect
                      </button>
                    </div>
                  </div>
                )}
                <div className="max-h-56 overflow-y-auto py-1.5">
                  {accounts.map((account) => {
                    const isActive = account.id === active?.id;
                    const canRemove = accounts.length > 1;
                    const showWarn = isActive && authDisconnected;
                    return (
                      <div
                        key={account.id}
                        className="group flex w-full items-center gap-1 px-1.5"
                      >
                        <button
                          type="button"
                          disabled={busy || isActive}
                          onClick={() => {
                            void (async () => {
                              if (isActive) return;
                              try {
                                setBusy(true);
                                await onSwitch(account.id);
                                close();
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-2 text-left text-sm transition-ui hover-subtle disabled:opacity-100"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <span style={{ color: "var(--text-muted)" }}>
                            {kindIcon(account.kind)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className="flex items-center gap-1 truncate text-xs font-medium"
                              style={{ color: "var(--text)" }}
                            >
                              <span className="truncate">{account.label}</span>
                              {showWarn && (
                                <AlertTriangle size={12} style={{ color: "#d97706" }} />
                              )}
                            </span>
                            <span
                              className="block truncate text-[10px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {account.email
                                ? maskEmail(account.email)
                                : account.base_url
                                  ? account.base_url.replace(/^https?:\/\//, "")
                                  : kindLabel(account.kind)}
                            </span>
                          </span>
                          {isActive && !showWarn && (
                            <Check size={14} style={{ color: "var(--accent)" }} />
                          )}
                        </button>
                        {canRemove && (
                          <button
                            type="button"
                            title="Remove account"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void (async () => {
                                try {
                                  setBusy(true);
                                  setError(null);
                                  await onRemove(account.id);
                                  if (accounts.length <= 2) close();
                                } catch (err) {
                                  setError(String(err).replace(/^Error:\s*/, ""));
                                } finally {
                                  setBusy(false);
                                }
                              })();
                            }}
                            className="shrink-0 rounded-md p-1.5 opacity-60 transition-ui hover-subtle group-hover:opacity-100 disabled:opacity-30"
                            style={{ color: "var(--danger)" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {error && step === "menu" && (
                    <p className="px-3 pb-1 text-[11px]" style={{ color: "var(--danger)" }}>
                      {error}
                    </p>
                  )}
                </div>
                <div
                  className="border-t py-1.5"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep("choose");
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-ui hover-subtle"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <Plus size={14} />
                    Add account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onManage();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-ui hover-subtle"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <User size={14} />
                    Account settings
                  </button>
                  {authDisconnected ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEmail(displayEmail ?? "");
                        setPassword("");
                        setStep("reauth");
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-ui hover-subtle"
                      style={{ color: "#d97706" }}
                    >
                      <AlertTriangle size={14} />
                      Reconnect
                    </button>
                  ) : (
                    onSignIn &&
                    !syncStatus?.logged_in &&
                    active?.kind !== "offline" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (active?.kind === "selfhost") {
                            setError(null);
                            setEmail(displayEmail ?? "");
                            setPassword("");
                            setStep("reauth");
                            return;
                          }
                          close();
                          onSignIn();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-ui hover-subtle"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <Globe size={14} />
                        Sign in
                      </button>
                    )
                  )}
                </div>
              </>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      {trigger}
      {panel}
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
      className="transition-ui flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left disabled:opacity-50"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-card-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium" style={{ color: "var(--text)" }}>
          {title}
        </span>
        <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
          {description}
        </span>
      </span>
    </button>
  );
}
