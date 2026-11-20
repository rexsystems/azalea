import { invoke } from "@tauri-apps/api/core";

export interface McpPrefs {
  enabled: boolean;
  port: number;
  allowKeys: boolean;
  allowHosts: boolean;
  allowExec: boolean;
  allowFiles: boolean;
  confirmActions: boolean;
}

export interface McpActivity {
  at: number;
  tool: string;
  target: string | null;
  outcome: "ok" | "error" | "blocked" | "declined";
}

export interface McpStatus {
  prefs: McpPrefs;
  running: boolean;
  url: string | null;
  token: string | null;
  lastError: string | null;
  activity: McpActivity[];
}

export function getMcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_status");
}

export function setMcpPrefs(prefs: McpPrefs): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_set_prefs", { prefs });
}

export function regenerateMcpToken(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_regenerate_token");
}

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http azalea ${url} --header "Authorization: Bearer ${token}"`;
}

export function jsonConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        azalea: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function connectClaudeCode(): Promise<string> {
  return invoke<string>("mcp_connect_claude_code");
}
