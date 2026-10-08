"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
// Icons: react-icons/fi is already a dep. Lucide was dropped repo-wide to
// shrink the client bundle and cut one npm supply-chain surface.
import { FiCheckCircle, FiHelpCircle, FiLoader, FiXCircle } from "react-icons/fi";
import { accessRedirect, resolveAccountAccess } from "@/lib/auth-access";
import { approveDesktopHandoff, ensureSession, getStoredSession } from "@/lib/azalea-api";
import { Logo } from "@/components/Logo";

type Phase = "checking" | "ready" | "handing-off" | "done" | "error";

function isValidPort(port: string | null): port is string {
  if (!port) return false;
  const n = Number(port);
  return Number.isInteger(n) && n >= 1024 && n <= 65535;
}

function isValidHandle(handle: string | null): handle is string {
  if (!handle) return false;
  // random_token() on the server returns 64 hex chars.
  return /^[a-f0-9]{16,128}$/i.test(handle);
}

function backPath(port: string, state: string, handle: string): string {
  return `/authorize?port=${port}&state=${encodeURIComponent(
    state,
  )}&handle=${encodeURIComponent(handle)}`;
}

function AuthorizeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const port = params.get("port");
  const state = params.get("state");
  const handle = params.get("handle");

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paramsValid =
    isValidPort(port) &&
    !!state &&
    state.length >= 8 &&
    state.length <= 128 &&
    isValidHandle(handle);

  useEffect(() => {
    let cancelled = false;

    if (!paramsValid) {
      setPhase("error");
      setError(
        "This link is missing or has invalid connection parameters. Start the sign-in again from the Azalea app.",
      );
      return;
    }

    void (async () => {
      const session = (await ensureSession()) ?? getStoredSession();
      if (cancelled) return;

      if (!session) {
        const back = backPath(port!, state!, handle!);
        router.replace(`/login?next=${encodeURIComponent(back)}`);
        return;
      }

      const access = await resolveAccountAccess();
      if (cancelled) return;
      if (access.status !== "ok") {
        router.replace(accessRedirect(access, backPath(port!, state!, handle!)));
        return;
      }

      setEmail(session.user.email ?? null);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [paramsValid, port, state, handle, router]);

  const handOff = useCallback(async () => {
    setPhase("handing-off");
    setError(null);

    // Step 1: exchange our web session for a short-lived one-time authorization
    // code bound to this PKCE handle. The code is worthless on its own; only
    // the desktop app (holding the matching code_verifier) can redeem it.
    let code: string;
    try {
      const approved = await approveDesktopHandoff(handle!, state!);
      code = approved.code;
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof Error
          ? err.message
          : "Could not authorize the desktop app. Try starting the sign-in again.",
      );
      return;
    }

    // Step 2: hand the code (NOT the refresh token) to the loopback listener
    // in the desktop app. The plain-HTTP hop is fine here because the code is
    // single-use, expires in 60 s, and can only be redeemed with the desktop
    // app's local code_verifier.
    try {
      const response = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ state, code }),
      });
      if (!response.ok) throw new Error("The desktop app rejected the sign-in.");
    } catch {
      setPhase("error");
      setError("Could not reach the Azalea app. Make sure it is still open and try again.");
      return;
    }

    setPhase("done");
  }, [handle, port, state]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-clip px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(255, 255, 255, 0.06), transparent 65%)",
        }}
      />
      <div className="rise relative z-10 w-full max-w-sm text-center">
        <Link href="/" className="mb-10 inline-flex items-center justify-center gap-2.5">
          <Logo size={30} style={{ color: "var(--accent)" }} />
          <span
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Azalea
          </span>
        </Link>

        {phase === "checking" && (
          <div className="flex flex-col items-center gap-4">
            <FiLoader size={30} className="animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Checking your session…
            </p>
          </div>
        )}

        {phase === "ready" && (
          <div className="flex flex-col items-center gap-5">
            <FiHelpCircle size={34} style={{ color: "var(--accent)" }} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Connect the desktop app?</h1>
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                This will sign the Azalea desktop app in as{" "}
                <span style={{ color: "var(--text-secondary)" }}>{email ?? "your account"}</span>.
                Only continue if you just started this from the app.
              </p>
            </div>
            <button className="btn btn-primary w-full" onClick={() => void handOff()}>
              Connect Azalea
            </button>
            <Link href="/account" className="text-xs" style={{ color: "var(--text-muted)" }}>
              Cancel
            </Link>
          </div>
        )}

        {phase === "handing-off" && (
          <div className="flex flex-col items-center gap-4">
            <FiLoader size={30} className="animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Connecting…
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col items-center gap-4">
            <FiCheckCircle size={34} style={{ color: "#4ade80" }} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">You&apos;re connected</h1>
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                Return to the Azalea desktop app — you can close this tab.
              </p>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-4">
            <FiXCircle size={34} style={{ color: "var(--danger)" }} />
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
            <Link href="/" className="btn btn-ghost">
              Go home
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeInner />
    </Suspense>
  );
}
