import { getStoredSession } from "./azalea-api";
import type { AdminSettings, AdminUser } from "./admin-users";

function apiBase() {
  return (process.env.NEXT_PUBLIC_AZALEA_API_URL ?? "/api").replace(/\/$/, "");
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new Error("Not signed in");
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : `HTTP ${res.status}`,
    );
  }
  return body as T;
}

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
