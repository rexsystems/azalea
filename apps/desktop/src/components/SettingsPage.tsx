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
import { UpdateSection } from "./UpdateSection";
import { Download, Upload } from "lucide-react";

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
  onSyncVaultApplied: (settings: unknown) => void;
  onSyncDataRefresh: () => Promise<void>;
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
  onSyncVaultApplied,
  onSyncDataRefresh,
}: SettingsPageProps) {
  return (
    <div
      className="flex h-full flex-col overflow-y-auto p-6"
      style={{ background: "var(--bg-base)" }}
    >
      <h2 className="mb-1 text-lg font-semibold" style={{ color: "var(--text)" }}>
        Settings
      </h2>
      <p className="mb-8 text-sm" style={{ color: "var(--text-muted)" }}>
        Appearance, connection behavior, and app info
      </p>

      <section className="mb-10">
        <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
          Connect experience
        </h3>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          How the app behaves when you open an SSH session
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {connectScreenOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onConnectScreenChange(opt.id)}
              className="hover-subtle transition-ui rounded-xl border p-4 text-left"
              style={{
                background:
                  connectScreen === opt.id ? "var(--accent-muted)" : "var(--bg-card)",
                borderColor:
                  connectScreen === opt.id ? "var(--accent)" : "var(--border-subtle)",
              }}
            >
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {opt.label}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
          Terminal
        </h3>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Copy, paste, and display preferences
        </p>
        <div
          className="space-y-2 rounded-xl border p-2"
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

        <div className="mt-4">
          <Slider
            label="Font size"
            min={11}
            max={22}
            step={1}
            value={terminalSettings.fontSize}
            formatValue={(v) => `${v}px`}
            onChange={(fontSize) => onTerminalSettingsChange({ fontSize: clampFontSize(fontSize) })}
          />
        </div>
      </section>

      <SyncSection
        getSettings={syncGetSettings}
        onVaultApplied={onSyncVaultApplied}
        onDataRefresh={onSyncDataRefresh}
      />

      <section className="mb-10">
        <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
          Backup &amp; restore
        </h3>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Export everything before reinstalling Windows — hosts, keys, passwords, groups, and settings.
        </p>
        <div
          className="space-y-3 rounded-xl border p-4"
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
      </section>

      <section className="mb-10">
        <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
          Theme
        </h3>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Pick a look for the app
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              className="hover-subtle transition-ui rounded-xl border p-4 text-left"
              style={{
                background: theme === t.id ? "var(--accent-muted)" : "var(--bg-card)",
                borderColor: theme === t.id ? "var(--accent)" : "var(--border-subtle)",
              }}
            >
              <div
                className="mb-3 h-8 w-8 rounded-lg border"
                style={{
                  background: t.preview,
                  borderColor: t.id === "noir" || t.id === "glossy" ? "var(--border)" : "transparent",
                }}
              />
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {t.name}
              </div>
            </button>
          ))}
        </div>
      </section>

      <UpdateSection />

      <section>
        <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
          About
        </h3>
        <div
          className="rounded-xl border px-4 py-3"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="font-medium" style={{ color: "var(--text)" }}>
            Azalea
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            Rexsystems
          </div>
        </div>
      </section>
    </div>
  );
}
