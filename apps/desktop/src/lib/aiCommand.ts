import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeTerminal } from "./api";

export interface AiCommandResult {
  output: string;
  exitCode: number;
}

// Control characters distinguish actual shell output from the echoed command.
export function trackedCommand(
  command: string,
  token: string,
  powershell = false,
): string {
  if (powershell) {
    const quoted = `'${command.replace(/'/g, "''")}'`;
    return `[Console]::Write([string][char]27 + ']9999;${token}:start' + [char]7); $global:LASTEXITCODE = 0; try { Invoke-Expression ${quoted}; $azaleaSucceeded = $?; $azaleaExit = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif ($azaleaSucceeded) { 0 } else { 1 } } catch { Write-Output $_; $azaleaExit = 1 }; [Console]::Write([string][char]27 + ']9999;${token}:done:' + $azaleaExit + [char]7)\r\n`;
  }
  const quoted = `'${command.replace(/'/g, "'\\''")}'`;
  return `printf '\\033]9999;%s:start\\007' '${token}'; eval ${quoted}; printf '\\033]9999;%s:done:%s\\007' '${token}' "$?"\n`;
}

export class CommandOutputTracker {
  private buffer = "";
  private started = false;
  output = "";
  constructor(private token: string) {}

  push(chunk: string): AiCommandResult | null {
    this.buffer += chunk;
    if (!this.started) {
      const start = `\x1b]9999;${this.token}:start\x07`;
      const index = this.buffer.indexOf(start);
      if (index < 0) {
        this.buffer = this.buffer.slice(-start.length);
        return null;
      }
      this.started = true;
      this.buffer = this.buffer.slice(index + start.length);
    }
    const end = new RegExp(`\x1b\\]9999;${this.token}:done:(\\d+)\x07`);
    const match = end.exec(this.buffer);
    if (match) {
      this.output = (this.output + this.buffer.slice(0, match.index)).slice(
        -64000,
      );
      return { output: this.output, exitCode: Number(match[1]) };
    }
    // Retain enough tail to recognize a marker split across output events.
    const keep = this.token.length + 40;
    if (this.buffer.length > keep) {
      this.output = (this.output + this.buffer.slice(0, -keep)).slice(-64000);
      this.buffer = this.buffer.slice(-keep);
    }
    return null;
  }

  snapshot(): string {
    if (!this.started) return "";
    return (
      this.output + this.buffer.replace(/\x1b(?:\]9999;[^\x07]*)?$/, "")
    ).slice(-64000);
  }
}

const runningSessions = new Set<string>();

export async function runAiCommand(
  sessionId: string,
  command: string,
  signal: AbortSignal,
  onOutput: (output: string) => void,
  powershell = false,
): Promise<AiCommandResult> {
  if (runningSessions.has(sessionId))
    throw new Error("A command is already running in this session.");
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  runningSessions.add(sessionId);
  const token = `azalea_${crypto.randomUUID().replace(/-/g, "")}`;
  const outputTracker = new CommandOutputTracker(token);
  const unlisteners: UnlistenFn[] = [];
  let disposed = false;
  const register = (unlisten: UnlistenFn) => {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  };
  let abort: () => void = () => {};
  try {
    return await new Promise<AiCommandResult>((resolve, reject) => {
      let settled = false;
      const finish = (result?: AiCommandResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(result!);
      };
      abort = () => {
        void writeTerminal(sessionId, btoa("\x03")).catch(() => {});
        finish(undefined, new DOMException("Stopped", "AbortError"));
      };
      void (async () => {
        const decoder = new TextDecoder();
        register(
          await listen<{ session_id: string; data: string }>(
            "terminal-output",
            ({ payload }) => {
              if (settled || payload.session_id !== sessionId) return;
              const bytes = Uint8Array.from(atob(payload.data), (c) =>
                c.charCodeAt(0),
              );
              const result = outputTracker.push(
                decoder.decode(bytes, { stream: true }),
              );
              onOutput(result?.output ?? outputTracker.snapshot());
              if (result) finish(result);
            },
          ),
        );
        register(
          await listen<{ session_id: string; status: string }>(
            "terminal-status",
            ({ payload }) => {
              if (
                payload.session_id === sessionId &&
                ["exited", "disconnected", "error"].includes(payload.status)
              ) {
                finish(
                  undefined,
                  new Error("Terminal disconnected before command completion."),
                );
              }
            },
          ),
        );
        if (signal.aborted) {
          finish(undefined, new DOMException("Stopped", "AbortError"));
          return;
        }
        if (settled) return;
        signal.addEventListener("abort", abort, { once: true });
        const bytes = new TextEncoder().encode(
          trackedCommand(command, token, powershell),
        );
        await writeTerminal(
          sessionId,
          btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")),
        );
      })().catch((err) => finish(undefined, err));
    });
  } finally {
    disposed = true;
    signal.removeEventListener("abort", abort);
    unlisteners.forEach((fn) => fn());
    runningSessions.delete(sessionId);
  }
}
