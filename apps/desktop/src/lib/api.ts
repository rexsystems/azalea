import type {
  CreateGroupInput,
  CreateHostInput,
  CreateKeyInput,
  CreatePortForwardInput,
  CreateSnippetInput,
  Host,
  HostGroup,
  ImportKeyInput,
  InstallPublicKeyResult,
  PortForward,
  PortForwardStatus,
  SftpListResult,
  Snippet,
  SshKey,
  UpdateGroupInput,
  UpdateHostInput,
} from "@azalea/shared";
import { invoke } from "@tauri-apps/api/core";

export function listGroups(): Promise<HostGroup[]> {
  return invoke("list_groups");
}

export function createGroup(input: CreateGroupInput): Promise<HostGroup> {
  return invoke("create_group", { input });
}

export function updateGroup(id: string, input: UpdateGroupInput): Promise<HostGroup> {
  return invoke("update_group", { id, input });
}

export function deleteGroup(id: string): Promise<void> {
  return invoke("delete_group", { id });
}

export function moveHostToGroup(hostId: string, groupId: string | null): Promise<void> {
  return invoke("move_host_to_group", {
    input: { host_id: hostId, group_id: groupId },
  });
}

export function listHosts(): Promise<Host[]> {
  return invoke("list_hosts");
}

export function createHost(input: CreateHostInput): Promise<Host> {
  return invoke("create_host", { input });
}

export function updateHost(id: string, input: UpdateHostInput): Promise<Host> {
  return invoke("update_host", { id, input });
}

export function deleteHost(id: string): Promise<void> {
  return invoke("delete_host", { id });
}

export function listKeys(): Promise<SshKey[]> {
  return invoke("list_keys");
}

export function generateKey(input: CreateKeyInput): Promise<SshKey> {
  return invoke("generate_key", { input });
}

export function importKey(input: ImportKeyInput): Promise<SshKey> {
  return invoke("import_key", { input });
}

export function deleteKey(id: string): Promise<void> {
  return invoke("delete_key", { id });
}

export function installPublicKey(
  keyId: string,
  hostId: string,
): Promise<InstallPublicKeyResult> {
  return invoke("install_public_key", { input: { key_id: keyId, host_id: hostId } });
}

export function prepareSsh(hostId: string): Promise<string> {
  return invoke("prepare_ssh", { hostId });
}

export function startSsh(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("start_ssh", {
    input: { host_id: sessionId, cols, rows },
  });
}

export function reconnectSsh(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("reconnect_ssh", {
    input: { session_id: sessionId, cols, rows },
  });
}

export function writeTerminal(sessionId: string, data: string): Promise<void> {
  if (isLocalSession(sessionId)) {
    return invoke("write_local_terminal", { sessionId, data });
  }
  return invoke("write_terminal", {
    input: { session_id: sessionId, data },
  });
}

export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  if (isLocalSession(sessionId)) {
    return invoke("resize_local_terminal", {
      sessionId,
      cols,
      rows,
    });
  }
  return invoke("resize_terminal", {
    input: { session_id: sessionId, cols, rows },
  });
}

// ---------- Local terminal ----------

export function isLocalSession(sessionId: string): boolean {
  return sessionId.startsWith("local-");
}

export function createLocalSessionId(): string {
  return `local-${crypto.randomUUID()}`;
}

export function startLocalTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("start_local_terminal", { sessionId, cols, rows });
}

export function closeLocalTerminal(sessionId: string): Promise<void> {
  return invoke("close_local_terminal", { sessionId });
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface PickedTextFile {
  path: string;
  name: string;
  contents: string;
}

/// The native picker runs in the backend, so no filesystem path is ever
/// accepted from the UI.
export function pickTextFile(filters: DialogFilter[]): Promise<PickedTextFile | null> {
  return invoke("pick_text_file", { filters });
}

export function saveTextFile(
  defaultName: string,
  filters: DialogFilter[],
  contents: string,
): Promise<string | null> {
  return invoke("save_text_file", { defaultName, filters, contents });
}

export function hostHasPassword(id: string): Promise<boolean> {
  return invoke("host_has_password", { id });
}

export function wakeOnLan(macAddress: string, broadcast?: string | null): Promise<void> {
  return invoke("wake_on_lan", {
    input: { mac_address: macAddress, broadcast: broadcast ?? null },
  });
}

export function disconnectSsh(sessionId: string): Promise<void> {
  return invoke("disconnect_ssh", { sessionId });
}

export function sftpList(sessionId: string, path?: string): Promise<SftpListResult> {
  return invoke("sftp_list", {
    input: { session_id: sessionId, path: path ?? null },
  });
}

export function sftpDownload(
  sessionId: string,
  remotePath: string,
  localPath: string,
): Promise<number> {
  return invoke("sftp_download", { sessionId, remotePath, localPath });
}

export function sftpUpload(
  sessionId: string,
  localPath: string,
  remotePath: string,
): Promise<number> {
  return invoke("sftp_upload", { sessionId, localPath, remotePath });
}

export function sftpReadText(sessionId: string, remotePath: string): Promise<string> {
  return invoke("sftp_read_text", { sessionId, remotePath });
}

export function sftpWriteText(
  sessionId: string,
  remotePath: string,
  contents: string,
): Promise<number> {
  return invoke("sftp_write_text", { sessionId, remotePath, contents });
}

export function listSnippets(): Promise<Snippet[]> {
  return invoke("list_snippets");
}

export function createSnippet(input: CreateSnippetInput): Promise<Snippet> {
  return invoke("create_snippet", { input });
}

export function updateSnippet(id: string, input: CreateSnippetInput): Promise<void> {
  return invoke("update_snippet", { id, input });
}

export function deleteSnippet(id: string): Promise<void> {
  return invoke("delete_snippet", { id });
}

export function listPortForwards(hostId?: string): Promise<PortForward[]> {
  return invoke("list_port_forwards", { hostId: hostId ?? null });
}

export function createPortForward(input: CreatePortForwardInput): Promise<PortForward> {
  return invoke("create_port_forward", { input });
}

export function deletePortForward(id: string): Promise<void> {
  return invoke("delete_port_forward", { id });
}

export function startForward(sessionId: string, forwardId: string): Promise<PortForwardStatus> {
  return invoke("start_forward", { sessionId, forwardId });
}

export function stopForward(sessionId: string, forwardId: string): Promise<void> {
  return invoke("stop_forward", { sessionId, forwardId });
}

export function listActiveForwards(sessionId: string): Promise<PortForwardStatus[]> {
  return invoke("list_active_forwards", { sessionId });
}

export function trustHostKey(sessionId: string): Promise<void> {
  return invoke("trust_host_key", { input: { session_id: sessionId } });
}

export function respondHostKey(sessionId: string, accept: boolean): Promise<void> {
  return invoke("respond_host_key", { sessionId, accept });
}

// ---------- Cloud sync ----------

export interface SyncStatus {
  configured: boolean;
  logged_in: boolean;
  email: string | null;
  unlocked: boolean;
  vault_exists: boolean | null;
  remote_version: number | null;
  last_synced_version: number;
  plan: "free" | "pro";
  storage_limit_bytes: number;
  cloud_used_bytes: number;
  local_estimated_bytes: number | null;
  storage_blocked: boolean;
}

export type SyncOutcome =
  | { status: "needs_setup" }
  | { status: "locked" }
  | { status: "in_sync"; version: number }
  | { status: "pushed"; version: number }
  | { status: "pulled"; version: number; settings: unknown }
  | { status: "conflict"; remote_version: number };

export interface ItemDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface VaultDiff {
  hosts: ItemDiff;
  keys: ItemDiff;
  groups: ItemDiff;
}

export type SyncPreview =
  | { status: "needs_setup" }
  | { status: "locked" }
  | { status: "in_sync"; version: number }
  | { status: "push"; remote_version: number; local: VaultDiff }
  | { status: "pull"; remote_version: number; remote: VaultDiff }
  | {
      status: "conflict";
      remote_version: number;
      local: VaultDiff;
      remote: VaultDiff;
    };

export function syncStatus(): Promise<SyncStatus> {
  return invoke("sync_status");
}

/**
 * Opens the system browser to sign in on the Azalea website, then receives the
 * session back on a one-shot loopback server. Resolves once signed in.
 */
export function syncBrowserLogin(): Promise<void> {
  return invoke("sync_browser_login");
}

export function syncLogout(): Promise<void> {
  return invoke("sync_logout");
}

export function syncSetupPassphrase(
  passphrase: string,
  settings: unknown,
): Promise<string> {
  return invoke("sync_setup_passphrase", { passphrase, settings });
}

export function syncUnlock(input: {
  passphrase?: string;
  recoveryKey?: string;
}): Promise<number> {
  return invoke("sync_unlock", {
    input: {
      passphrase: input.passphrase ?? null,
      recovery_key: input.recoveryKey ?? null,
    },
  });
}

export function syncPreview(settings: unknown): Promise<SyncPreview> {
  return invoke("sync_preview", { settings });
}

export function syncNow(
  settings: unknown,
  resolution?: "keep_local" | "keep_cloud",
): Promise<SyncOutcome> {
  return invoke("sync_now", { settings, resolution: resolution ?? null });
}
