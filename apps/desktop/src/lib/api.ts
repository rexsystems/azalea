import type {
  CreateGroupInput,
  CreateHostInput,
  CreateKeyInput,
  Host,
  HostGroup,
  ImportKeyInput,
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

export function writeTerminal(sessionId: string, data: string): Promise<void> {
  return invoke("write_terminal", {
    input: { session_id: sessionId, data },
  });
}

export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("resize_terminal", {
    input: { session_id: sessionId, cols, rows },
  });
}

export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

export function disconnectSsh(sessionId: string): Promise<void> {
  return invoke("disconnect_ssh", { sessionId });
}
