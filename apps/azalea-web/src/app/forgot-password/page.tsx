"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forgotPassword } from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || email.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
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

        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">Reset password</h1>
        <p className="mb-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {done
            ? "If that email exists and mail is configured, a reset link was sent."
            : "Enter your account email and we will send a reset link."}
        </p>

        {done ? (
          <button type="button" className="btn btn-primary w-full" onClick={() => router.push("/login")}>
            Back to sign in
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              className="field"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={busy || email.trim().length < 3}
            >
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          <Link href="/login" className="underline" style={{ color: "var(--text)" }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
