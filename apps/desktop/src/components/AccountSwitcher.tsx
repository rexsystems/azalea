import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AccountKind, AccountRecord, SyncStatus } from "../lib/api";
import { maskEmail } from "../lib/utils";
import {
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
  onRemove: (id: string) => void | Promise<void>;
  onManage: () => void;
  onSignIn?: () => void;
  compact?: boolean;
}

type AddStep = "menu" | "choose" | "selfhost";

function kindIcon(kind: AccountKind): ReactNode {
  if (kind === "cloud") return <Globe size={14} />;
  if (kind === "selfhost") return <Server size={14} />;
  return <SquareTerminal size={14} />;
}

function kindLabel(kind: AccountKind): string {
  if (kind === "cloud") return "Cloud";
  if (kind === "selfhost") return "Self-hosted";
  return "Offline";
}

const fieldClass =
  "transition-ui w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-[var(--accent)] placeholder:opacity-50";
const fieldStyle: React.CSSProperties = {
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
  onRemove,
  onManage,
  onSignIn,
  compact = false,
}: AccountSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddStep>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [panelPos, setPanelPos] = useState<{
    left: number;
    bottom?: number;
    top?: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setStep("menu");
    setError(null);
  };

  const placePanel = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, compact ? 280 : 260);
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

  const displayEmail = syncStatus?.email ?? active?.email ?? null;
  const title = displayEmail
    ? maskEmail(displayEmail)
    : active?.label ?? "Local";
  const subtitle = active ? kindLabel(active.kind) : "Account";

  const addAccount = async (kind: AccountKind) => {
    try {
      setBusy(true);
      setError(null);
      if (kind === "selfhost") {
        const { base_url, web_url } = resolveSelfHostUrls(serverUrl);
        await onAdd({
          kind: "selfhost",
          label: "Self-hosted",
          base_url,
          web_url,
        });
      } else if (kind === "cloud") {
        await onAdd({ kind: "cloud", label: "Azalea Cloud" });
      } else {
        await onAdd({ kind: "offline", label: "Offline" });
      }
      setServerUrl("");
      close();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

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
      {syncStatus?.logged_in ? (
        <PlanBadge plan={syncStatus.plan} />
      ) : (
        <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
          Accounts
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
        <div className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
          {title}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {syncStatus?.logged_in ? (
            <PlanBadge plan={syncStatus.plan} />
          ) : (
            <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              {subtitle}
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
                    onClick={() => void addAccount("cloud")}
                  />
                  <ChoiceRow
                    icon={<Server size={15} />}
                    title="Self-hosted"
                    description="Your own server"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setStep("selfhost");
                    }}
                  />
                  <ChoiceRow
                    icon={<SquareTerminal size={15} />}
                    title="Offline"
                    description="Local only"
                    disabled={busy}
                    onClick={() => void addAccount("offline")}
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
                  onClick={() => void addAccount("selfhost")}
                  className="home-action-primary transition-ui w-full rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "Adding…" : "Add account"}
                </button>
              </div>
            ) : (
              <>
                <div className="max-h-56 overflow-y-auto py-1.5">
                  {accounts.map((account) => {
                    const isActive = account.id === active?.id;
                    const canRemove = accounts.length > 1;
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
                              className="block truncate text-xs font-medium"
                              style={{ color: "var(--text)" }}
                            >
                              {account.label}
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
                          {isActive && (
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
                  {onSignIn &&
                    !syncStatus?.logged_in &&
                    active?.kind !== "offline" && (
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          onSignIn();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-ui hover-subtle"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <Globe size={14} />
                        Sign in
                      </button>
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
