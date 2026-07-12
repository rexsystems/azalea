export interface HostFormValues {
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  key_id: string | null;
  group_id: string | null;
  password: string;
}

export function parseQuickConnect(input: string): Partial<HostFormValues> {
  const trimmed = input.trim();
  if (!trimmed) return {};

  let username = "root";
  let hostname = trimmed;
  let port = 22;

  const atIndex = trimmed.indexOf("@");
  if (atIndex > 0) {
    username = trimmed.slice(0, atIndex);
    hostname = trimmed.slice(atIndex + 1);
  }

  const colonIndex = hostname.lastIndexOf(":");
  if (colonIndex > 0) {
    const maybePort = hostname.slice(colonIndex + 1);
    const parsedPort = Number(maybePort);
    if (!Number.isNaN(parsedPort) && maybePort === String(parsedPort)) {
      port = parsedPort;
      hostname = hostname.slice(0, colonIndex);
    }
  }

  return {
    username,
    hostname,
    port,
    name: hostname.split(".")[0] || hostname,
  };
}

export function formatHostAddress(host: {
  username: string;
  hostname: string;
  port: number;
}): string {
  const portSuffix = host.port === 22 ? "" : `:${host.port}`;
  return `${host.username}@${host.hostname}${portSuffix}`;
}

export function getHostInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function filenameToKeyName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "Imported Key";
  return base;
}

export interface GroupedHosts<T extends { group_id: string | null }> {
  group: { id: string | null; name: string } | null;
  hosts: T[];
}

export function groupHostsByGroup<T extends { group_id: string | null; name: string }>(
  hosts: T[],
  groups: { id: string; name: string }[],
): GroupedHosts<T>[] {
  const result: GroupedHosts<T>[] = [];

  for (const group of groups) {
    const inGroup = hosts
      .filter((h) => h.group_id === group.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    result.push({ group: { id: group.id, name: group.name }, hosts: inGroup });
  }

  const ungrouped = hosts
    .filter((h) => !h.group_id)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (ungrouped.length > 0) {
    result.push({ group: null, hosts: ungrouped });
  }

  return result;
}
