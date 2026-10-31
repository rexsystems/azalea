/**
 * Conservative read-only check for shell commands the assistant suggests.
 * A command counts as read only when every part of a pipeline or command
 * list is a known inspection command with no flag that writes. Anything
 * else, including unknown commands, redirects and substitutions, is not.
 * The label is a hint for the reader, never a permission check.
 */

const READ_ONLY = new Set([
  "awk",
  "cat",
  "date",
  "df",
  "dig",
  "du",
  "echo",
  "file",
  "free",
  "getent",
  "grep",
  "egrep",
  "head",
  "host",
  "hostname",
  "hostnamectl",
  "id",
  "less",
  "ls",
  "lsblk",
  "lsof",
  "more",
  "netstat",
  "nproc",
  "ping",
  "printenv",
  "ps",
  "pwd",
  "rg",
  "ss",
  "stat",
  "tail",
  "top",
  "tree",
  "uname",
  "uptime",
  "w",
  "wc",
  "which",
  "who",
  "whoami",
]);

/** Subcommands that only read, for tools whose other subcommands write. */
const READ_ONLY_SUB: Record<string, Set<string>> = {
  docker: new Set(["ps", "logs", "inspect", "images", "stats", "version", "info", "top"]),
  git: new Set(["status", "log", "diff", "show", "branch", "remote", "rev-parse"]),
  ip: new Set(["a", "addr", "address", "route", "r", "link", "neigh"]),
  journalctl: new Set(["*"]),
  kubectl: new Set(["get", "describe", "logs", "top", "version"]),
  nginx: new Set(["-t", "-T", "-v", "-V"]),
  systemctl: new Set([
    "status",
    "is-active",
    "is-enabled",
    "is-failed",
    "list-units",
    "show",
    "cat",
  ]),
};

/** Flags that turn an otherwise read-only command into one that writes. */
const WRITING_FLAGS: Record<string, RegExp> = {
  find: /(^|\s)-(delete|exec|execdir|ok|fprint)/,
  journalctl: /--(vacuum|rotate|flush|setup-keys)/,
  awk: /system\s*\(|>\s*"/,
};

/** sudo options that take a separate value, as in "sudo -u deploy". */
const SUDO_ARG_FLAGS = new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-R", "-r", "-t", "-U"]);

function words(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function segmentIsReadOnly(segment: string): boolean {
  let parts = words(segment);
  while (parts[0] === "sudo" || /^[A-Z_][A-Z0-9_]*=/.test(parts[0] ?? "")) {
    const isSudo = parts[0] === "sudo";
    parts = parts.slice(1);
    while (isSudo && parts[0]?.startsWith("-")) {
      parts = parts.slice(SUDO_ARG_FLAGS.has(parts[0]) ? 2 : 1);
    }
  }
  const [cmd, ...rest] = parts;
  if (!cmd) return false;
  const writing = WRITING_FLAGS[cmd];
  if (writing?.test(rest.join(" "))) return false;
  if (cmd === "find") return true;
  if (READ_ONLY.has(cmd)) return true;
  const subs = READ_ONLY_SUB[cmd];
  if (!subs) return false;
  if (subs.has("*")) return true;
  const sub = rest.find((word) => cmd === "nginx" || !word.startsWith("-"));
  return sub != null && subs.has(sub);
}

export function isReadOnlyCommand(command: string): boolean {
  const text = command.trim();
  if (!text) return false;
  // Redirects, substitutions and here-docs can write or run anything.
  if (/[<>`]|\$\(|\btee\b/.test(text.replace(/2>&1|>\s*\/dev\/null/g, ""))) return false;
  const segments = text.split(/\|\||&&|[|;\n]/);
  return segments.every((segment) => segment.trim() === "" || segmentIsReadOnly(segment));
}
