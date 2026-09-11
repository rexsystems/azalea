"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { resetPassword, TURNSTILE_SITE_KEY } from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Consume the token from the URL exactly once on mount, then strip the
  // query string. This keeps the reset token out of `document.referrer` (any
  // outbound click) and out of browser history.
  const [token, setToken] = useState<string>("");
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const raw = params.get("token")?.trim() ?? "";
    setToken(raw);
    if (raw) {
      router.replace("/reset-password");
    }
  }, [params, router]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const captchaRequired = TURNSTILE_SITE_KEY.length > 0;
  const ready =
    token.length > 0 &&
    password.length >= 8 &&
    password === confirm &&
    (!captchaRequired || captchaToken !== null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password, captchaToken);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCaptchaToken(null);
      turnstileRef.current?.reset();
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
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => router.push("/login")}
          >
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
            {captchaRequired && (
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setCaptchaToken}
                onExpire={() => setCaptchaToken(null)}
                options={{ theme: "dark" }}
              />
            )}
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
