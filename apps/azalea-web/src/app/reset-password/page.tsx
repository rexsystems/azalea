"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = token.length > 0 && password.length >= 8 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-clip px-6 py-16">
      <div className="hero-glow" aria-hidden />
      <div className="rise relative z-10 w-full max-w-sm">
        <Link href="/" className="mb-10 flex items-center justify-center gap-2.5">
          <Logo size={28} style={{ color: "var(--accent)" }} />
          <span
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Azalea
          </span>
        </Link>

        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="mb-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {done
            ? "Password updated. You can sign in now."
            : token
              ? "Use at least 8 characters."
              : "This reset link is missing a token."}
        </p>

        {!token ? (
          <Link href="/forgot-password" className="btn btn-primary w-full text-center">
            Request a new link
          </Link>
        ) : done ? (
          <button type="button" className="btn btn-primary w-full" onClick={() => router.push("/login")}>
            Sign in
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
            {error && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary w-full" disabled={!ready || busy}>
              {busy ? "Saving..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
