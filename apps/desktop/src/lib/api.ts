import type {
  CreateGroupInput,
  CreateHostInput,
  CreateKeyInput,
  CreatePortForwardInput,
  CreateSnippetInput,
  Host,
  HostGroup,
  ImportKeyInput,
  PortForward,
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

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export function hostHasPassword(id: string): Promise<boolean> {
  return invoke("host_has_password", { id });
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

export function startForward(sessionId: string, forwardId: string): Promise<void> {
  return invoke("start_forward", { sessionId, forwardId });
}

export function stopForward(sessionId: string, forwardId: string): Promise<void> {
  return invoke("stop_forward", { sessionId, forwardId });
}

export function listActiveForwards(sessionId: string): Promise<string[]> {
  return invoke("list_active_forwards", { sessionId });
}

export function trustHostKey(input: {
  hostname: string;
  port: number;
  key_type: string;
  public_key: string;
  fingerprint: string;
}): Promise<void> {
  return invoke("trust_host_key", { input });
}
