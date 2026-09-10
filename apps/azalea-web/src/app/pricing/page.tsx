/** Removed from self-host build; marketing lives on azalea.rexsystems.me */
export default function PricingGone() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <meta httpEquiv="refresh" content="0;url=/login" />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace("/login");`,
        }}
      />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        <a href="/login" className="underline" style={{ color: "var(--text)" }}>
          Sign in
        </a>
      </p>
    </main>
  );
}
