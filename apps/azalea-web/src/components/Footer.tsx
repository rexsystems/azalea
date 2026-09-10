import Link from "next/link";

/** Slim footer for self-host dashboard. */
export function Footer() {
  return (
    <footer
      className="glass-surface relative z-20 border-t px-5 py-6 md:px-8"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 text-center text-xs sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p style={{ color: "var(--text-muted)" }}>
          Azalea · self-hosted · {new Date().getFullYear()}
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-5 sm:justify-end">
          <Link href="/login" className="nav-link text-xs">
            Sign in
          </Link>
          <Link href="/account" className="nav-link text-xs">
            Account
          </Link>
          <Link href="/admin" className="nav-link text-xs">
            Admin
          </Link>
        </nav>
      </div>
    </footer>
  );
}
