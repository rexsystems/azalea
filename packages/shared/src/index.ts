export type AuthType = "password" | "key";

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
}

export interface ImportKeyInput {
  name: string;
  private_key_pem: string;
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

export interface TerminalStatusEvent {
  session_id: string;
  status: TerminalSession["status"];
  error?: string;
}
