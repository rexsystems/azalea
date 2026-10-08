import { apiRequest } from "./azalea-api";
import type { AdminSettings, AdminUser } from "./admin-users";

const adminFetch = apiRequest;

export function listAdminUsers() {
  return adminFetch<AdminUser[]>("/v1/admin/users");
}

export function getAdminSettings() {
  return adminFetch<AdminSettings>("/v1/admin/settings");
}

export function patchAdminSettings(body: Partial<AdminSettings> & { captcha_secret_key?: string }) {
  return adminFetch<AdminSettings>("/v1/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function createAdminUser(input: {
  email: string;
  password: string;
  role: "user" | "admin";
  plan: "free" | "pro";
}) {
  return adminFetch<AdminUser>("/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchAdminUser(
  id: string,
  body: {
    disabled?: boolean;
    role?: "user" | "admin";
    plan?: "free" | "pro";
    password?: string;
  },
) {
  return adminFetch<{ ok: boolean }>(`/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface ServerAiProvider {
  id: string;
  name: string;
  provider: string;
  dialect: "openai" | "anthropic";
  base_url: string;
  models: { id: string; label: string }[];
  key_configured: boolean;
}

export interface ServerAiSettings {
  enabled: boolean;
  default_model: string;
  requests_per_minute: number;
  max_output_tokens: number;
  providers: ServerAiProvider[];
}

export function getServerAiSettings() { return adminFetch<ServerAiSettings>("/v1/admin/ai"); }
export function saveServerAiSettings(input: Omit<ServerAiSettings, "providers"> & { providers: (ServerAiProvider & { api_key?: string; clear_key?: boolean })[] }) {
  return adminFetch<ServerAiSettings>("/v1/admin/ai", { method: "PUT", body: JSON.stringify(input) });
}
export function getServerProviderModels(id: string) {
  return adminFetch<{ id: string; label: string }[]>(`/v1/admin/ai/providers/${encodeURIComponent(id)}/models`);
}
