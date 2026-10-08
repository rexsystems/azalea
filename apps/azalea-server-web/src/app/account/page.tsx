"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  clearSession,
  getAccount,
  getStoredSession,
  logout,
  type SessionUser,
} from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [vaultBytes, setVaultBytes] = useState(0);
  const [limitBytes, setLimitBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setUser(session.user);
      try {
        const account = await getAccount();
        setPlan(account.plan);
        setVaultBytes(account.vault_bytes);
        setLimitBytes(account.vault_limit_bytes);
        setUser({
          id: session.user.id,
          email: account.email,
          role: account.role,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [router]);

  const signOut = async () => {
    setBusy(true);
    await logout();
    clearSession();
    router.replace("/login");
  };

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Logo size={36} className="animate-pulse" style={{ color: "var(--accent)" }} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-16">
      <Link href="/" className="mb-10 inline-flex items-center gap-2.5">
        <Logo size={24} style={{ color: "var(--accent)" }} />
        <span className="text-lg font-semibold">Azalea</span>
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        {user.email}
      </p>

      <div
        className="mt-8 space-y-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--text-muted)" }}>Plan</span>
          <span
            style={{
              color:
                user.role === "admin"
                  ? "var(--danger)"
                  : plan === "pro"
                    ? "var(--accent)"
                    : "var(--text)",
              fontWeight: 550,
            }}
          >
            {user.role === "admin" ? "Admin" : plan === "pro" ? "Pro" : "Free"}
          </span>
        </div>
        {user.role !== "admin" ? (
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--text-muted)" }}>Role</span>
            <span style={{ color: "var(--text)" }}>{user.role}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--text-muted)" }}>Vault</span>
          <span style={{ color: "var(--text)" }}>
            {Math.round(vaultBytes / 1024)} / {Math.round(limitBytes / 1024)} KB
          </span>
        </div>
      </div>

      {user.role === "admin" && (
        <Link href="/admin" className="btn btn-ghost mt-4 w-full text-center">
          Admin panel
        </Link>
      )}

      {error && (
        <p className="mt-4 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button className="btn btn-primary mt-6 w-full" disabled={busy} onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}
