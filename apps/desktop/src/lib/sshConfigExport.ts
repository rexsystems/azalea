import { invoke } from "@tauri-apps/api/core";

export interface SshConfigExportStatus {
  enabled: boolean;
  agentSupported: boolean;
  configPath: string;
  agentSocket: string | null;
  exportedHosts: number;
  skippedHosts: number;
  lastError: string | null;
}

export function getSshConfigExport(): Promise<SshConfigExportStatus> {
  return invoke<SshConfigExportStatus>("openssh_export_status");
}

export function setSshConfigExport(enabled: boolean): Promise<SshConfigExportStatus> {
  return invoke<SshConfigExportStatus>("openssh_export_set", { enabled });
}
