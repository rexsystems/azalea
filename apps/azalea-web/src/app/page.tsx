/** Self-host dashboard home: no marketing landing. */
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <meta httpEquiv="refresh" content="0;url=/login" />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace("/login");`,
        }}
      />
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
