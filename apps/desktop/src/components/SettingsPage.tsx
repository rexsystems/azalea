import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Download, Upload } from "./icons";
import { getVersion } from "@tauri-apps/api/app";
import type { ThemeId } from "../lib/theme";
import { themes } from "../lib/theme";
import {
  clampFontSize,
  connectScreenOptions,
  type ConnectScreenMode,
  type TerminalSettings,
} from "../lib/settings";
import { Button } from "./ui/Button";
import { SettingToggle } from "./ui/SettingToggle";
import { Slider } from "./ui/Slider";
import { SyncSection } from "./SyncSection";
import { PlanBadge } from "./PlanBadge";
import { UpdateSection } from "./UpdateSection";
import type { SyncStatus } from "../lib/api";

type SettingsTab = "appearance" | "connect" | "terminal" | "account" | "backup" | "about";

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
  syncGetSettings: () => unknown;
  syncStatus: SyncStatus | null;
  onSyncStatusChange: (status: SyncStatus) => void;
  onSyncVaultApplied: (settings: unknown) => void;
  onSyncDataRefresh: () => Promise<void>;
  focusSync?: boolean;
  onFocusSyncHandled?: () => void;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "connect", label: "Connect" },
  { id: "terminal", label: "Terminal" },
  { id: "account", label: "Account" },
  { id: "backup", label: "Backup" },
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
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
  syncGetSettings,
  syncStatus,
  onSyncStatusChange,
  onSyncVaultApplied,
  onSyncDataRefresh,
  focusSync = false,
  onFocusSyncHandled,
}: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);

  useEffect(() => {
    if (!focusSync) return;
    setTab("account");
    onFocusSyncHandled?.();
  }, [focusSync, onFocusSyncHandled]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell flex min-h-0 flex-1 flex-col !pb-0">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 shrink-0">
          <div>
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
            >
              Settings
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              Manage appearance, sessions, sync, and backups
            </p>
          </div>
          {syncStatus?.logged_in && (
            <div
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
            >
              <div
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                Plan
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <PlanBadge plan={syncStatus.plan} size="md" />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {syncStatus.plan === "pro" ? "10 MB vault" : "256 KB vault"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div
          className="settings-tabs mb-5 flex shrink-0 gap-1 overflow-x-auto pb-1"
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
                onClick={() => setTab(item.id)}
                className="transition-ui shrink-0 rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  background: active ? "var(--bg-panel)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  border: active ? "1px solid var(--border-subtle)" : "1px solid transparent",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-2xl border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <div className="p-5 sm:p-6">
            {tab === "appearance" && (
              <>
                <PanelHeader
                  title="Appearance"
                  description="Choose how Azalea looks across the app."
                />
                <SettingRow label="Theme" description="Pick a color scheme for the whole UI.">
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
                            background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                            borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                          }}
                        >
                          <div
                            className="relative h-16 w-full sm:h-[4.25rem]"
                            style={{
                              background: `linear-gradient(145deg, ${t.preview} 0%, color-mix(in srgb, ${t.preview} 55%, #000) 100%)`,
                            }}
                          >
                            {selected && (
                              <span
                                className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  background: "color-mix(in srgb, var(--bg-base) 75%, transparent)",
                                  color: "var(--text)",
                                }}
                              >
                                Active
                              </span>
                            )}
                          </div>
                          <div className="px-3 py-2.5 text-sm font-medium" style={{ color: "var(--text)" }}>
                            {t.name}
                          </div>
                        </button>
                      );
                    })}
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
                            background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                            borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                          }}
                        >
                          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
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
                      onChange={(v) => onTerminalSettingsChange({ selectToCopy: v })}
                    />
                    <SettingToggle
                      label="Right-click to paste"
                      description="Paste from clipboard on right click"
                      checked={terminalSettings.rightClickToPaste}
                      onChange={(v) => onTerminalSettingsChange({ rightClickToPaste: v })}
                    />
                  </div>
                </SettingRow>
                <SettingRow label="Font size" description="Terminal text size in pixels.">
                  <Slider
                    min={12}
                    max={26}
                    step={1}
                    value={terminalSettings.fontSize}
                    formatValue={(v) => `${v}px`}
                    onChange={(fontSize) =>
                      onTerminalSettingsChange({ fontSize: clampFontSize(fontSize) })
                    }
                  />
                </SettingRow>
              </>
            )}

            {tab === "account" && (
              <>
                <PanelHeader
                  title="Account & sync"
                  description="Encrypted cloud backup for hosts, keys, and settings."
                  action={
                    syncStatus?.logged_in ? <PlanBadge plan={syncStatus.plan} size="md" /> : null
                  }
                />
                <SyncSection
                  embedded
                  status={syncStatus}
                  onStatusChange={onSyncStatusChange}
                  getSettings={syncGetSettings}
                  onVaultApplied={onSyncVaultApplied}
                  onDataRefresh={onSyncDataRefresh}
                />
              </>
            )}

            {tab === "backup" && (
              <>
                <PanelHeader
                  title="Backup & restore"
                  description="Export an unencrypted archive of hosts, keys, passwords, groups, and settings. Keep it somewhere safe."
                />
                <SettingRow label="Local backup">
                  <div className="space-y-2">
                    <Button className="w-full" disabled={backupBusy} onClick={onExportBackup}>
                      <Download size={16} />
                      Export Azalea backup
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" disabled={backupBusy} onClick={onImportBackup}>
                        <Upload size={16} />
                        Import backup
                      </Button>
                      <Button
                        variant="danger"
                        disabled={backupBusy}
                        onClick={onImportBackupReplace}
                      >
                        Replace &amp; import
                      </Button>
                    </div>
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
                    <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
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
                    <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      Rexsystems
                    </div>
                  </div>
                </SettingRow>
                <SettingRow label="Updates" description="Check for signed desktop releases.">
                  <UpdateSection embedded />
                </SettingRow>
              </>
            )}
          </div>
        </div>

        <div className="h-6 shrink-0 sm:h-8" />
      </div>
    </div>
  );
}
