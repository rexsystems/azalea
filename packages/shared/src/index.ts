export type AuthType = "password" | "key" | "none";

export interface HostGroup {
  id: string;
  name: string;
  created_at: number;
}

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: AuthType;
  key_id: string | null;
  group_id: string | null;
  mac_address: string | null;
  /** Detected remote OS id after a successful connect (ubuntu, debian, …). */
  os_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateHostInput {
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: AuthType;
  key_id?: string | null;
  group_id?: string | null;
  password?: string | null;
  mac_address?: string | null;
}

export interface UpdateHostInput {
  name?: string;
  hostname?: string;
  port?: number;
  username?: string;
  auth_type?: AuthType;
  key_id?: string | null;
  group_id?: string | null;
  password?: string | null;
  mac_address?: string | null;
}

export interface CreateGroupInput {
  name: string;
}

export interface UpdateGroupInput {
  name: string;
}

export interface SshKey {
  id: string;
  name: string;
  public_key: string;
  key_type: string;
  fingerprint: string;
  created_at: number;
}

export interface CreateKeyInput {
  name: string;
  algorithm?: "ed25519" | "rsa" | "ecdsa-p256" | "ecdsa-p384" | "ecdsa-p521";
}

export interface InstallPublicKeyResult {
  status: "installed" | "already_present" | string;
  message: string;
}

export interface ImportKeyInput {
  name: string;
  private_key_pem: string;
  passphrase?: string | null;
}

export interface TerminalSession {
  id: string;
  host_id: string;
  host_name: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
}

export interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

export interface ImportResult {
  hosts_imported: number;
  keys_imported: number;
  groups_imported: number;
  format: string;
}

export interface AzaleaBackup {
  format: "azalea-backup";
  version: number;
  exported_at: number;
  settings?: Record<string, unknown>;
  groups: HostGroup[];
  hosts: Array<Host & { password?: string | null }>;
  keys: Array<SshKey & { private_key_pem?: string | null }>;
}

export interface ImportBackupResult {
  hosts_imported: number;
  keys_imported: number;
  groups_imported: number;
  settings?: Record<string, unknown>;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
  created_at: number;
}

export interface CreateSnippetInput {
  name: string;
  command: string;
}

export interface PortForward {
  id: string;
  host_id: string;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  created_at: number;
}

export interface CreatePortForwardInput {
  host_id: string;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

/** Live status for a running (or failed) local port forward. */
export interface PortForwardStatus {
  session_id: string;
  forward_id: string;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  /** `listening` | `connected` | `failed` | `stopped` */
  state: "listening" | "connected" | "failed" | "stopped" | string;
  connections: number;
  error: string | null;
}

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mtime: number | null;
}

export interface SftpListResult {
  path: string;
  entries: FileEntry[];
}

export interface HostKeyMismatchEvent {
  session_id: string;
  hostname: string;
  port: number;
  key_type: string;
  old_fingerprint: string;
  new_fingerprint: string;
  public_key: string;
}

export interface HostKeyUnknownEvent {
  session_id: string;
  hostname: string;
  port: number;
  key_type: string;
  fingerprint: string;
  public_key: string;
}

export interface HostOsUpdatedEvent {
  host_id: string;
  os_id: string;
}
