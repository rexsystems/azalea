"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredSession } from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  plan: string;
  disabled: boolean;
  vault_bytes: number;
  created_at: string;
};

type Settings = {
  signup_enabled: boolean;
  captcha_provider: string;
  captcha_site_key: string;
  captcha_secret_configured: boolean;
  free_limit_bytes: number;
  pro_limit_bytes: number;
  instance_name: string;
};

function apiBase() {
  return (process.env.NEXT_PUBLIC_AZALEA_API_URL ?? "").replace(/\/$/, "");
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
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [nextUsers, nextSettings] = await Promise.all([
      adminFetch<AdminUser[]>("/v1/admin/users"),
      adminFetch<Settings>("/v1/admin/settings"),
    ]);
    setUsers(nextUsers);
    setSettings(nextSettings);
  };

  useEffect(() => {
    void (async () => {
      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      try {
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [router]);

  const toggleSignup = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const next = await adminFetch<Settings>("/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ signup_enabled: !settings.signup_enabled }),
      });
      setSettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, role: "user" }),
      });
      setEmail("");
      setPassword("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/account" className="inline-flex items-center gap-2.5">
          <Logo size={22} style={{ color: "var(--accent)" }} />
          <span className="font-semibold">Admin</span>
        </Link>
        <Link href="/account" className="text-sm" style={{ color: "var(--text-muted)" }}>
          Back
        </Link>
      </div>

      {error && (
        <p className="mb-4 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {settings && (
        <section
          className="mb-8 rounded-xl border p-4"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <h2 className="text-sm font-medium">Instance</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {settings.instance_name}
          </p>
          <button className="btn btn-ghost mt-4" disabled={busy} onClick={() => void toggleSignup()}>
            Signup: {settings.signup_enabled ? "Enabled" : "Disabled"}
          </button>
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Password reset mail is configured with Resend env vars on azalea-server (`RESEND_API_KEY`).
          </p>
        </section>
      )}

      <section
        className="mb-8 rounded-xl border p-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <h2 className="text-sm font-medium">Create user</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="field"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => void createUser()}>
            Create
          </button>
        </div>
      </section>

      <section className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
          >
            <div>
              <div className="text-sm font-medium">{user.email}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {user.role} · {user.plan}
                {user.disabled ? " · disabled" : ""} · {Math.round(user.vault_bytes / 1024)} KB
              </div>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
