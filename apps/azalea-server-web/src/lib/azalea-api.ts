export type SessionUser = {
  id: string;
  email: string;
  role: string;
};

/**
 * Client-side session shape. The refresh token is intentionally NOT part of
 * this type - it lives in an HttpOnly cookie set by azalea-server. The access
 * token is short-lived (10 min) and kept in localStorage under STORAGE_KEY.
 */
export type Session = {
  access_token: string;
  expires_in: number;
  user: SessionUser;
};

const STORAGE_KEY = "azalea.session";

export function apiBase(): string {
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

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...options } = init;
  const send = () => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    const token = auth ? getStoredSession()?.access_token : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${apiBase()}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  };
  let res = await send();
  if (res.status === 401 && auth && (await refreshSession()))
    res = await send();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : `Request failed (${res.status})`,
      res.status,
      typeof body?.error === "string" ? body.error : undefined,
    );
  }
  return body as T;
}

const request = apiRequest;
let refreshInFlight: Promise<Session | null> | null = null;

function sessionUsable(session: Session | null): boolean {
  if (!session) return false;
  try {
    const payload = JSON.parse(
      atob(
        session.access_token
          .split(".")[1]
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
      ),
    );
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
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

/**
 * Ask the server for a fresh access token. The refresh token itself lives in
 * an HttpOnly cookie, so we send an empty body and rely on `credentials:
 * "include"`.
 */
export async function refreshSession(): Promise<Session | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const session = await request<Session>("/v1/auth/refresh", {
        method: "POST",
        auth: false,
        body: JSON.stringify({}),
      });
      storeSession(session);
      return session;
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 401 || err.status === 403) &&
        !sessionUsable(getStoredSession())
      )
        clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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

export async function forgotPassword(
  email: string,
  captchaToken?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  return request("/v1/auth/forgot-password", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      email,
      captcha_token: captchaToken ?? undefined,
    }),
  });
}

export async function resetPassword(
  token: string,
  password: string,
  captchaToken?: string | null,
): Promise<{ ok: boolean }> {
  return request("/v1/auth/reset-password", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      token,
      password,
      captcha_token: captchaToken ?? undefined,
    }),
  });
}

export async function ensureSession(): Promise<Session | null> {
  const refreshed = await refreshSession();
  if (refreshed) return refreshed;
  const current = getStoredSession();
  return sessionUsable(current) ? current : null;
}

// ---------- Desktop PKCE authorization handoff ----------

export type DesktopApproveResponse = {
  code: string;
  expires_in: number;
};

export async function approveDesktopHandoff(
  handle: string,
  clientState: string,
): Promise<DesktopApproveResponse> {
  return request<DesktopApproveResponse>("/v1/auth/desktop/approve", {
    method: "POST",
    body: JSON.stringify({ handle, client_state: clientState }),
  });
}

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export interface AuthConfig {
  signup_enabled: boolean;
  captcha_provider: string;
  captcha_site_key: string;
}
export function getAuthConfig() {
  return apiRequest<AuthConfig>("/v1/auth/config", { auth: false });
}
