import type { SessionUser } from "./azalea-api";
import { ensureSession, getAccount, getStoredSession } from "./azalea-api";

export type AccountAccess =
  | { status: "ok"; user: SessionUser }
  | { status: "unauthenticated" };

export function siteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
}

export async function resolveAccountAccess(): Promise<AccountAccess> {
  const session = (await ensureSession()) ?? getStoredSession();
  if (!session?.user) return { status: "unauthenticated" };
  try {
    await getAccount();
    return { status: "ok", user: session.user };
  } catch {
    return { status: "unauthenticated" };
  }
}

export function accessRedirect(access: AccountAccess, dest: string): string {
  if (access.status === "unauthenticated") return "/login";
  return dest;
}
