import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  EthernetPort,
  Info,
  Palette,
  SquareTerminal,
  Download,
  Upload,
} from "lucide-react";
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

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="mb-3 flex items-start gap-3">
        <div className="settings-section-icon" aria-hidden>
          {icon}
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
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
  const syncRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);

  useEffect(() => {
    if (!focusSync) return;
    const node = syncRef.current;
    if (node) {
      window.requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    onFocusSyncHandled?.();
  }, [focusSync, onFocusSyncHandled]);

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Settings
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Appearance, sync, and how sessions open
            </p>
          </div>
          {syncStatus?.logged_in && (
            <div
              className="rounded-lg border px-2.5 py-1.5"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
            >
              <div
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                Plan
              </div>
              <div className="mt-1 flex items-center gap-2">
                <PlanBadge plan={syncStatus.plan} size="md" />
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {syncStatus.plan === "pro" ? "10 MB" : "256 KB"}
                </span>
              </div>
            </div>
          )}
        </div>

        <Section
          icon={<EthernetPort size={16} />}
          title="Connect experience"
          description="What happens when you open an SSH session"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {connectScreenOptions.map((opt) => {
              const selected = connectScreen === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onConnectScreenChange(opt.id)}
                  className="hover-subtle transition-ui rounded-lg border px-3 py-3 text-left"
                  style={{
                    background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                    borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                  }}
                >
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {opt.label}
                  </div>
                  <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          icon={<SquareTerminal size={16} />}
          title="Terminal"
          description="Copy, paste, and display preferences"
        >
          <div
            className="space-y-1 rounded-lg border p-1.5"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
          >
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

          <div className="mt-3">
            <Slider
              label="Font size"
              min={12}
              max={26}
              step={1}
              value={terminalSettings.fontSize}
              formatValue={(v) => `${v}px`}
              onChange={(fontSize) =>
                onTerminalSettingsChange({ fontSize: clampFontSize(fontSize) })
              }
            />
          </div>
        </Section>

        <div ref={syncRef}>
          <SyncSection
            status={syncStatus}
            onStatusChange={onSyncStatusChange}
            getSettings={syncGetSettings}
            onVaultApplied={onSyncVaultApplied}
            onDataRefresh={onSyncDataRefresh}
          />
        </div>

        <Section
          icon={<Archive size={16} />}
          title="Backup & restore"
          description="Hosts, keys, passwords, groups, and settings in one unencrypted file — keep it somewhere safe"
        >
          <div
            className="space-y-2 rounded-lg border p-3"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
          >
            <Button className="w-full" disabled={backupBusy} onClick={onExportBackup}>
              <Download size={16} />
              Export Azalea backup
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={backupBusy} onClick={onImportBackup}>
                <Upload size={16} />
                Import backup
              </Button>
              <Button variant="danger" disabled={backupBusy} onClick={onImportBackupReplace}>
                Replace &amp; import
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<Palette size={16} />} title="Theme" description="Pick a look for the app">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {themes.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onThemeChange(t.id)}
                  className="hover-subtle transition-ui rounded-lg border p-2.5 text-left"
                  style={{
                    background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                    borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                  }}
                >
                  <div
                    className="mb-2 h-7 w-7 rounded-md border"
                    style={{
                      background: t.preview,
                      borderColor:
                        t.id === "noir" || t.id === "snow" ? "var(--border)" : "transparent",
                    }}
                  />
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
                    {t.name}
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        <UpdateSection />

        <Section icon={<Info size={16} />} title="About">
          <div
            className="rounded-lg border px-3 py-2.5"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Azalea
            </div>
            <div className="mt-1 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
              Version {appVersion}
              <span style={{ color: "var(--text-muted)" }}> · </span>
              Build {__AZALEA_BUILD__}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              Rexsystems
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
