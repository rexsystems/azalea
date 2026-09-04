import type { ImportBackupResult, ImportResult } from "@azalea/shared";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectScreenMode, TerminalSettings } from "./settings";
import {
  getStoredAutoSync,
  getStoredConnectScreen,
  getStoredTerminalSettings,
  setStoredAutoSync,
  setStoredConnectScreen,
  setStoredTerminalSettings,
} from "./settings";
import type { ThemeId } from "./theme";
import { getStoredTheme, setStoredTheme } from "./theme";
import * as api from "./api";

export interface AppSettingsExport {
  theme: ThemeId;
  connectScreen: ConnectScreenMode;
  terminalSettings: TerminalSettings;
  autoSync: boolean;
}

export function collectAppSettings(): AppSettingsExport {
  return {
    theme: getStoredTheme(),
    connectScreen: getStoredConnectScreen(),
    terminalSettings: getStoredTerminalSettings(),
    autoSync: getStoredAutoSync(),
  };
}

export function applyAppSettings(settings: Partial<AppSettingsExport>) {
  if (settings.theme) setStoredTheme(settings.theme);
  if (settings.connectScreen) setStoredConnectScreen(settings.connectScreen);
  if (settings.terminalSettings) setStoredTerminalSettings(settings.terminalSettings);
  if (typeof settings.autoSync === "boolean") setStoredAutoSync(settings.autoSync);
}

export function exportBackup(settings: AppSettingsExport): Promise<string> {
  return invoke("export_backup", { settings });
}

export function importAzaleaBackup(data: string, replace: boolean): Promise<ImportBackupResult> {
  return invoke("import_backup", { input: { data, replace } });
}

export function importDataFile(data: string, replace: boolean): Promise<ImportResult> {
  return invoke("import_data_file", { data, replace });
}

export async function exportBackupToFile(settings: AppSettingsExport): Promise<string | null> {
  const json = await exportBackup(settings);
  const stamp = new Date().toISOString().slice(0, 10);
  return api.saveTextFile(
    `azalea-backup-${stamp}.json`,
    [{ name: "Azalea Backup", extensions: ["json"] }],
    json,
  );
}

export async function importBackupFromFile(replace: boolean): Promise<ImportBackupResult | ImportResult | null> {
  const picked = await api.pickTextFile([
    { name: "Backup / Import", extensions: ["json", "tbk", "conf", "cfg", "txt"] },
  ]);
  if (!picked) return null;
  const data = picked.contents;
  if (data.includes('"format": "azalea-backup"') || data.includes('"format":"azalea-backup"')) {
    return importAzaleaBackup(data, replace);
  }
  return importDataFile(data, replace);
}
