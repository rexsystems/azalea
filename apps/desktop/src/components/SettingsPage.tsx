import type { ReactNode } from "react";
import { startTransition, useEffect, useRef, useState } from "react";
import { Download } from "./icons";
import { getVersion } from "@tauri-apps/api/app";
import type { ThemeId } from "../lib/theme";
import { themes } from "../lib/theme";
import { iconPacks, type IconPackId } from "../lib/iconPack";
import { useIconPack } from "./IconPackProvider";
import { hugeiconsPack } from "./icons/hugeiconsPack";
import { pixelartPack } from "./icons/pixelartPack";
import {
  CUSTOM_CSS_EVENT,
  CUSTOM_CSS_PLACEHOLDER,
  clearCustomCss,
  getStoredCustomCss,
  setCustomCssEnabledFlag,
  setStoredCustomCss,
} from "../lib/customCss";
import {
  clampFontSize,
  connectScreenOptions,
  getStoredHideHostAddresses,
  setStoredHideHostAddresses,
  type ConnectScreenMode,
  type TerminalSettings,
} from "../lib/settings";
import { Button } from "./ui/Button";
import { SettingToggle } from "./ui/SettingToggle";
import { Slider } from "./ui/Slider";
import { SyncSection } from "./SyncSection";
import { ImportSection } from "./ImportSection";
import { UpdateSection } from "./UpdateSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { VoiceSettingsSection } from "./VoiceSettingsSection";
import type { AccountKind, AccountRecord, SyncStatus } from "../lib/api";
import { isTelemetryEnabled, setTelemetryEnabled } from "../lib/telemetry";

type SettingsTab =
  | "appearance"
  | "connect"
  | "terminal"
  | "ai"
  | "voice"
  | "account"
  | "import"
  | "backup"
  | "privacy"
  | "about";

interface SettingsPageProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  connectScreen: ConnectScreenMode;
  onConnectScreenChange: (mode: ConnectScreenMode) => void;
  terminalSettings: TerminalSettings;
  onTerminalSettingsChange: (patch: Partial<TerminalSettings>) => void;
  backupBusy?: boolean;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onImportBackupReplace: () => void;
  onImportDataRefresh?: () => Promise<void>;
  syncGetSettings: () => unknown;
  syncStatus: SyncStatus | null;
  onSyncStatusChange: (status: SyncStatus) => void;
  onSyncVaultApplied: (settings: unknown) => void;
  onSyncDataRefresh: () => Promise<void>;
  accountKind?: AccountKind | null;
  activeAccount?: AccountRecord | null;
  focusSync?: boolean;
  onFocusSyncHandled?: () => void;
  focusImport?: boolean;
  onFocusImportHandled?: () => void;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "connect", label: "Connect" },
  { id: "terminal", label: "Terminal" },
  { id: "ai", label: "AI" },
  { id: "voice", label: "Voice" },
  { id: "account", label: "Account" },
  { id: "import", label: "Import" },
  { id: "backup", label: "Backup" },
  { id: "privacy", label: "Privacy" },
  { id: "about", label: "About" },
];

function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="mb-6 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="min-w-0">
        <h3
          className="text-base font-semibold"
          style={{ color: "var(--text)" }}
        >
          {title}
        </h3>
        <p
          className="mt-1 text-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="grid gap-3 border-b py-5 last:border-b-0 sm:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)]"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </div>
        {description && (
          <p
            className="mt-1 text-xs leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsPage({
  theme,
  onThemeChange,
  connectScreen,
  onConnectScreenChange,
  terminalSettings,
  onTerminalSettingsChange,
  backupBusy = false,
  onExportBackup,
  onImportBackup,
  onImportBackupReplace,
  onImportDataRefresh,
  syncGetSettings,
  syncStatus,
  onSyncStatusChange,
  onSyncVaultApplied,
  onSyncDataRefresh,
  accountKind = null,
  activeAccount = null,
  focusSync = false,
  onFocusSyncHandled,
  focusImport = false,
  onFocusImportHandled,
}: SettingsPageProps) {
  const { iconPack, changeIconPack } = useIconPack();
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [importVisited, setImportVisited] = useState(false);
  const [appVersion, setAppVersion] = useState("…");
  const [telemetryOn, setTelemetryOn] = useState(() => isTelemetryEnabled());
  const [hideHostAddresses, setHideHostAddresses] = useState(() =>
    getStoredHideHostAddresses(),
  );
  const [customCssEnabled, setCustomCssEnabled] = useState(
    () => getStoredCustomCss().enabled,
  );
  const [customCssDraft, setCustomCssDraft] = useState(
    () => getStoredCustomCss().css,
  );
  const [customCssSaved, setCustomCssSaved] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("-"));
  }, []);

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    if (tab !== "appearance") return;
    const stored = getStoredCustomCss();
    setCustomCssEnabled(stored.enabled);
    setCustomCssDraft(stored.css);
    setCustomCssSaved(false);
  }, [tab]);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean; css: string }>)
        .detail;
      if (!detail) return;
      setCustomCssEnabled(detail.enabled);
      setCustomCssDraft(detail.css);
    };
    window.addEventListener(CUSTOM_CSS_EVENT, sync);
    return () => window.removeEventListener(CUSTOM_CSS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (tab === "import") setImportVisited(true);
  }, [tab]);

  const selectTab = (next: SettingsTab) => {
    startTransition(() => setTab(next));
  };

  useEffect(() => {
    if (!focusSync) return;
    selectTab("account");
    onFocusSyncHandled?.();
  }, [focusSync, onFocusSyncHandled]);

  useEffect(() => {
    if (!focusImport) return;
    selectTab("import");
    onFocusImportHandled?.();
  }, [focusImport, onFocusImportHandled]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div
        ref={contentScrollRef}
        className="settings-shell min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mb-5">
          <h2
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-display, inherit)",
            }}
          >
            Settings
          </h2>
          <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            Manage appearance, sessions, sync, and backups
          </p>
        </div>

        <div
          className="settings-tabs mb-5 flex gap-1 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(item.id)}
                className="transition-ui shrink-0 rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  background: active ? "var(--bg-panel)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  border: active
                    ? "1px solid var(--border-subtle)"
                    : "1px solid transparent",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          className="rounded-2xl border"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-panel)",
          }}
        >
          <div className="p-5 sm:p-6">
            {tab === "appearance" && (
              <>
                <PanelHeader
                  title="Appearance"
                  description="Choose how Azalea looks across the app."
                />
                <SettingRow
                  label="Theme"
                  description="Pick a color scheme for the whole UI."
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {themes.map((t) => {
                      const selected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onThemeChange(t.id)}
                          className="hover-subtle transition-ui overflow-hidden rounded-2xl border text-left"
                          style={{
                            background: selected
                              ? "var(--accent-muted)"
                              : "var(--bg-card)",
                            borderColor: selected
                              ? "var(--accent)"
                              : "var(--border-subtle)",
                          }}
                        >
                          <div
                            className="relative h-16 w-full sm:h-[4.25rem]"
                            style={{
                              background: `linear-gradient(145deg, ${t.preview} 0%, color-mix(in srgb, ${t.preview} 55%, #000) 100%)`,
                            }}
                          >
                            {t.experimental && (
                              <span
                                className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--bg-base) 75%, transparent)",
                                  color: "var(--text)",
                                }}
                              >
                                Experimental
                              </span>
                            )}
                            {selected && (
                              <span
                                className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--bg-base) 75%, transparent)",
                                  color: "var(--text)",
                                }}
                              >
                                Active
                              </span>
                            )}
                          </div>
                          <div
                            className="px-3 py-2.5 text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {t.name}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>

                <SettingRow
                  label="Icons"
                  description="Switch the app icon pack. Pixel Icons is experimental."
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {iconPacks.map((pack) => {
                      const selected = iconPack === pack.id;
                      const Preview =
                        pack.id === "pixelart" ? pixelartPack : hugeiconsPack;
                      return (
                        <button
                          key={pack.id}
                          type="button"
                          onClick={() => changeIconPack(pack.id as IconPackId)}
                          className="hover-subtle transition-ui rounded-xl border px-3.5 py-3.5 text-left"
                          style={{
                            background: selected
                              ? "var(--accent-muted)"
                              : "var(--bg-card)",
                            borderColor: selected
                              ? "var(--accent)"
                              : "var(--border-subtle)",
                          }}
                        >
                          <div
                            className="mb-2.5 flex items-center gap-2.5"
                            style={{ color: "var(--text)" }}
                          >
                            <Preview.Home size={18} />
                            <Preview.Server size={18} />
                            <Preview.KeyRound size={18} />
                            <Preview.Settings size={18} />
                          </div>
                          <div
                            className="text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {pack.name}
                          </div>
                          <div
                            className="mt-1 text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {pack.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>

                <SettingRow
                  label="Custom CSS"
                  description="Inject your own CSS on top of the active theme. Override variables like --bg-base and --accent."
                >
                  <div className="grid gap-3">
                    <SettingToggle
                      label="Enable custom CSS"
                      description="Uses the last applied CSS. Edit the box and click Apply CSS to save changes."
                      checked={customCssEnabled}
                      onChange={(checked) => {
                        setCustomCssEnabled(checked);
                        setCustomCssEnabledFlag(checked);
                        setCustomCssSaved(false);
                      }}
                    />
                    <textarea
                      value={customCssDraft}
                      onChange={(e) => {
                        setCustomCssDraft(e.target.value);
                        setCustomCssSaved(false);
                      }}
                      spellCheck={false}
                      placeholder={CUSTOM_CSS_PLACEHOLDER}
                      rows={12}
                      className="select-text w-full resize-y rounded-xl border px-3.5 py-3 font-mono text-xs leading-relaxed outline-none"
                      style={{
                        background: "var(--bg-input)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text)",
                        minHeight: "12rem",
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setStoredCustomCss({
                            enabled: customCssEnabled,
                            css: customCssDraft,
                          });
                          setCustomCssSaved(true);
                        }}
                      >
                        Apply CSS
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          clearCustomCss();
                          setCustomCssDraft("");
                          setCustomCssEnabled(false);
                          setCustomCssSaved(false);
                        }}
                      >
                        Clear
                      </Button>
                      {customCssSaved ? (
                        <span
                          className="text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Applied
                        </span>
                      ) : null}
                    </div>
                  </div>
                </SettingRow>
              </>
            )}

            {tab === "connect" && (
              <>
                <PanelHeader
                  title="Connect experience"
                  description="Control what you see when opening an SSH session."
                />
                <SettingRow
                  label="Session open"
                  description="Animated connect screen or jump straight into the terminal."
                >
                  <div className="grid gap-3">
                    {connectScreenOptions.map((opt) => {
                      const selected = connectScreen === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onConnectScreenChange(opt.id)}
                          className="hover-subtle transition-ui rounded-xl border px-3.5 py-3.5 text-left"
                          style={{
                            background: selected
                              ? "var(--accent-muted)"
                              : "var(--bg-card)",
                            borderColor: selected
                              ? "var(--accent)"
                              : "var(--border-subtle)",
                          }}
                        >
                          <div
                            className="text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {opt.label}
                          </div>
                          <div
                            className="mt-1.5 text-xs leading-relaxed"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {opt.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>
              </>
            )}

            {tab === "terminal" && (
              <>
                <PanelHeader
                  title="Terminal"
                  description="Copy, paste, and display preferences for sessions."
                />
                <SettingRow label="Clipboard">
                  <div className="space-y-2">
                    <SettingToggle
                      label="Select to copy"
                      description="Copy selected text to clipboard automatically"
                      checked={terminalSettings.selectToCopy}
                      onChange={(v) =>
                        onTerminalSettingsChange({ selectToCopy: v })
                      }
                    />
                    <SettingToggle
                      label="Right-click to paste"
                      description="Paste from clipboard on right click"
                      checked={terminalSettings.rightClickToPaste}
                      onChange={(v) =>
                        onTerminalSettingsChange({ rightClickToPaste: v })
                      }
                    />
                  </div>
                </SettingRow>
                <SettingRow
                  label="Font size"
                  description="Terminal text size in pixels."
                >
                  <Slider
                    min={12}
                    max={26}
                    step={1}
                    value={terminalSettings.fontSize}
                    formatValue={(v) => `${v}px`}
                    onChange={(fontSize) =>
                      onTerminalSettingsChange({
                        fontSize: clampFontSize(fontSize),
                      })
                    }
                  />
                </SettingRow>
              </>
            )}

            {tab === "account" && (
              <>
                <PanelHeader
                  title="Account"
                  description={
                    accountKind === "offline"
                      ? "Local profile. Hosts and keys stay on this device."
                      : accountKind === "selfhost"
                        ? "Your instance, vault status, and master password."
                        : "Sign-in, vault, and encrypted cloud backup."
                  }
                />
                <SyncSection
                  embedded
                  status={syncStatus}
                  onStatusChange={onSyncStatusChange}
                  getSettings={syncGetSettings}
                  onVaultApplied={onSyncVaultApplied}
                  onDataRefresh={onSyncDataRefresh}
                  accountKind={accountKind}
                  account={activeAccount}
                />
              </>
            )}

            {(tab === "import" || importVisited) && (
              <div
                className={tab === "import" ? undefined : "hidden"}
                aria-hidden={tab !== "import"}
              >
                <PanelHeader
                  title="Import"
                  description="Bring in keys and hosts from ~/.ssh, or restore from an Azalea backup / config file."
                />
                <ImportSection
                  busy={backupBusy}
                  onImportBackup={onImportBackup}
                  onImportBackupReplace={onImportBackupReplace}
                  onDataChanged={onImportDataRefresh ?? (async () => undefined)}
                />
              </div>
            )}

            {tab === "backup" && (
              <>
                <PanelHeader
                  title="Backup & restore"
                  description="Export an unencrypted archive of hosts, keys, passwords, groups, and settings. Keep it somewhere safe."
                />
                <SettingRow label="Local backup">
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      disabled={backupBusy}
                      onClick={onExportBackup}
                    >
                      <Download size={16} />
                      Export Azalea backup
                    </Button>
                    <p
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      To import a backup or OpenSSH files, use the Import tab.
                    </p>
                  </div>
                </SettingRow>
              </>
            )}

            {tab === "ai" && (
              <>
                <PanelHeader
                  title="AI"
                  description="Bring your own API keys. Prompts go to the provider you choose. Off by default."
                />
                <SettingRow
                  label="Terminal AI"
                  description="Ask and Agent modes in the active terminal session."
                >
                  <AiSettingsSection />
                </SettingRow>
              </>
            )}

            {tab === "voice" && (
              <>
                <PanelHeader
                  title="Voice assistant"
                  description="Local speech recognition and spoken replies. Disabled by default."
                />
                <SettingRow label="Hey Azalea">
                  <VoiceSettingsSection />
                </SettingRow>
              </>
            )}

            {tab === "privacy" && (
              <>
                <PanelHeader
                  title="Privacy"
                  description="Azalea asks once at startup whether to share anonymous usage and crash data. Change it anytime here."
                />
                <SettingRow label="Diagnostics">
                  <div className="space-y-2">
                    <SettingToggle
                      label="Share anonymous usage & crash reports"
                      description="Daily install ping (active users) and crash reports to help fix bugs. Never includes hostnames, emails, keys, or commands."
                      checked={telemetryOn}
                      onChange={(on) => {
                        setTelemetryEnabled(on);
                        setTelemetryOn(on);
                      }}
                    />
                  </div>
                </SettingRow>
                <SettingRow label="Hosts">
                  <div className="space-y-2">
                    <SettingToggle
                      label="Hide addresses on host cards"
                      description="Show only the username on Home and Hosts cards. Hostname and IP stay available in Edit and connect flows."
                      checked={hideHostAddresses}
                      onChange={(on) => {
                        setStoredHideHostAddresses(on);
                        setHideHostAddresses(on);
                        window.dispatchEvent(
                          new Event("azalea-hide-host-addresses"),
                        );
                      }}
                    />
                  </div>
                </SettingRow>
              </>
            )}

            {tab === "about" && (
              <>
                <PanelHeader
                  title="About"
                  description="Version info and application updates."
                />
                <SettingRow label="Application">
                  <div
                    className="rounded-xl border px-3.5 py-3"
                    style={{
                      background: "var(--bg-card)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <div
                      className="text-sm font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      Azalea
                    </div>
                    <div
                      className="mt-1 text-xs tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Version {appVersion}
                      <span style={{ color: "var(--text-muted)" }}> · </span>
                      Build {__AZALEA_BUILD__}
                    </div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      RexSystems
                    </div>
                  </div>
                </SettingRow>
                <SettingRow
                  label="Updates"
                  description="Download and install the latest desktop release."
                >
                  <UpdateSection embedded />
                </SettingRow>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
