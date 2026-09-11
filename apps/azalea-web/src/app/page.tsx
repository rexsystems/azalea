/** Self-host dashboard home: no marketing landing. */
export default function HomePage() {
  // Nginx already returns 302 /login for the root route. This page only
  // renders in edge cases where the request bypasses nginx. We use a
  // <meta http-equiv="refresh"> instead of an inline <script>, so the site
  // can ship a strict CSP with script-src 'self' and no 'unsafe-inline'.
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <meta httpEquiv="refresh" content="0;url=/login" />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Redirecting to{" "}
        <a href="/login" className="underline" style={{ color: "var(--text)" }}>
          sign in
        </a>
        …
      </p>
    </main>
  );
}
