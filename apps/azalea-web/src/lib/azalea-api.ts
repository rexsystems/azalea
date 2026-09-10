export type SessionUser = {
  id: string;
  email: string;
  role: string;
};

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SessionUser;
};

const STORAGE_KEY = "azalea.session";

function apiBase(): string {
  const url = process.env.NEXT_PUBLIC_AZALEA_API_URL?.trim();
  if (!url) {
    // Docker / self-host: nginx serves the site and proxies /api -> azalea-server
    return "/api";
  }
  return url.replace(/\/$/, "");
}

export function getStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function storeSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.auth !== false) {
    const session = getStoredSession();
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
    }
  }
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : `Request failed (${res.status})`,
    );
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const session = await request<Session>("/v1/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
  storeSession(session);
  return session;
}

export async function register(
  email: string,
  password: string,
  captchaToken?: string | null,
): Promise<Session> {
  const session = await request<Session>("/v1/auth/register", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      email,
      password,
      captcha_token: captchaToken ?? undefined,
    }),
  });
  storeSession(session);
  return session;
}

export async function refreshSession(): Promise<Session | null> {
  const current = getStoredSession();
  if (!current?.refresh_token) return null;
  try {
    const session = await request<Session>("/v1/auth/refresh", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    storeSession(session);
    return session;
  } catch {
    clearSession();
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await request("/v1/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  clearSession();
}

export async function getAccount(): Promise<{
  email: string;
  role: string;
  plan: string;
  vault_bytes: number;
  vault_limit_bytes: number;
}> {
  return request("/v1/account");
}

export async function forgotPassword(email: string): Promise<{ ok: boolean; message?: string }> {
  return request("/v1/auth/forgot-password", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<{ ok: boolean }> {
  return request("/v1/auth/reset-password", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ token, password }),
  });
}

export async function ensureSession(): Promise<Session | null> {
  const current = getStoredSession();
  if (!current) return null;
  return (await refreshSession()) ?? current;
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
