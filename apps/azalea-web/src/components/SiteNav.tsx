import Link from "next/link";
import { Logo } from "./Logo";

/** Slim nav for self-host dashboard (no marketing links). */
export function SiteNav() {
  return (
    <header className="glass-surface relative z-20 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 md:h-16 md:px-8">
        <Link href="/login" className="flex shrink-0 items-center gap-2.5">
          <Logo size={22} style={{ color: "var(--accent)" }} />
          <span
            className="text-base font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Azalea
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/account" className="nav-link">
            Account
          </Link>
          <Link href="/admin" className="nav-link">
            Admin
          </Link>
          <Link href="/login" className="nav-link">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
