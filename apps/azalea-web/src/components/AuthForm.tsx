"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { accessRedirect, resolveAccountAccess } from "@/lib/auth-access";
import { login, register, TURNSTILE_SITE_KEY } from "@/lib/azalea-api";
import { Logo } from "./Logo";

interface AuthFormProps {
  mode: "login" | "signup";
}

/**
 * Only accept in-app paths for the post-login redirect. Rejects protocol-
 * relative URLs (`//evil.com`), absolute URLs, values containing backslashes
 * or control characters, and anything that resolves to a different origin.
 */
function safeNext(next: string | null): string {
  if (!next) return "/account";
  if (/[\\\u0000-\u001f]/.test(next)) return "/account";
  if (!next.startsWith("/") || next.startsWith("//")) return "/account";
  if (typeof window === "undefined") return next;
  try {
    const parsed = new URL(next, window.location.origin);
    if (parsed.origin !== window.location.origin) return "/account";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/account";
  }
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const dest = safeNext(next);
  const withNext = (path: string) =>
    next ? `${path}?next=${encodeURIComponent(next)}` : path;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const access = await resolveAccountAccess();
      if (cancelled) return;
      if (access.status !== "unauthenticated") {
        router.replace(accessRedirect(access, dest));
        return;
      }
      setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, dest]);

  const isSignup = mode === "signup";
  const captchaRequired = TURNSTILE_SITE_KEY.length > 0;
  const ready =
    email.trim().length > 3 &&
    password.length >= 8 &&
    (!isSignup || password === confirm) &&
    (!captchaRequired || captchaToken !== null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    try {
      if (isSignup) {
        await register(email.trim(), password, captchaToken);
      } else {
        await login(email.trim(), password);
      }
      const access = await resolveAccountAccess();
      router.push(accessRedirect(access, dest));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCaptchaToken(null);
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Logo size={36} className="animate-pulse" style={{ color: "var(--accent)" }} />
      </main>
    );
  }

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
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mb-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {next
            ? "Sign in to connect the Azalea desktop app."
            : isSignup
              ? "One account, every device."
              : "Sign in to manage your account and vault."}
        </p>

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
          <input
            className="field"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {isSignup && (
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
          )}
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
            {busy ? "Please wait..." : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href={withNext("/login")} className="underline" style={{ color: "var(--text)" }}>
                Sign in
              </Link>
            </>
          ) : (
            <>
              Need an account?{" "}
              <Link href={withNext("/signup")} className="underline" style={{ color: "var(--text)" }}>
                Sign up
              </Link>
              {" · "}
              <Link href="/forgot-password" className="underline" style={{ color: "var(--text)" }}>
                Forgot password
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
