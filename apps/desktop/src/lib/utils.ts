export interface HostFormValues {
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: "password" | "key" | "none";
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

export function parsePortInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function isValidIpv6(value: string): boolean {
  const normalized = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!normalized.includes(":")) return false;
  if (!/^[\da-fA-F:]+$/.test(normalized)) return false;
  const groups = normalized.split("::");
  if (groups.length > 2) return false;
  return true;
}

export function isValidHostname(hostname: string): boolean {
  const value = hostname.trim();
  if (!value || value.length > 253) return false;
  if (value.includes(":")) return isValidIpv6(value);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return isValidIpv4(value);
  if (value.endsWith(".")) return false;

  const labels = value.split(".");
  return labels.every((label) => {
    if (!label || label.length > 63) return false;
    return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label);
  });
}

export function validateHostForm(values: HostFormValues, isEdit: boolean): string | null {
  const hostname = values.hostname.trim();
  if (!hostname) return "Address is required.";
  if (!isValidHostname(hostname)) {
    return "Enter a valid IP address or hostname.";
  }

  if (!isValidPort(values.port)) {
    return "Port must be between 1 and 65535.";
  }

  const username = values.username.trim();
  if (!username) return "Username is required.";

  if (values.auth_type === "password") {
    if (!isEdit && !values.password.trim()) {
      return "Password is required for password login.";
    }
  }

  if (values.auth_type === "key" && values.key_id && !values.key_id.trim()) {
    return "Choose an SSH key or switch to password login.";
  }

  return null;
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at >= trimmed.length - 1) return "••••@••••";

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");

  const maskedLocal =
    local.length <= 1 ? "•" : `${local[0]}${"•".repeat(Math.min(4, local.length - 1))}`;

  if (dot <= 0) {
    const head = domain[0] ?? "•";
    return `${maskedLocal}@${head}${"•".repeat(Math.min(3, Math.max(domain.length - 1, 1)))}`;
  }

  const domainName = domain.slice(0, dot);
  const tld = domain.slice(dot);
  const maskedDomain =
    domainName.length <= 1
      ? "•"
      : `${domainName[0]}${"•".repeat(Math.min(3, domainName.length - 1))}`;

  return `${maskedLocal}@${maskedDomain}${tld}`;
}
