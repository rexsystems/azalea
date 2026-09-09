"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

interface AdminLayoutProps {
  title: string;
  subtitle: string;
  pendingCount?: number;
  children: React.ReactNode;
}

function navClass(active: boolean): string {
  return active ? "btn btn-primary px-3 py-1.5 text-sm" : "btn btn-ghost px-3 py-1.5 text-sm";
}

export function AdminLayout({ title, subtitle, pendingCount = 0, children }: AdminLayoutProps) {
  const pathname = usePathname();
  const onPending = pathname === "/admin/pending";

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={24} style={{ color: "var(--accent)" }} />
          <span
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Azalea
          </span>
        </Link>
        <Link href="/account" className="btn btn-ghost">
          Account
        </Link>
      </header>

      <div className="rise mb-6 flex flex-wrap items-center gap-2">
        <Link href="/admin" className={navClass(!onPending)}>
          All users
        </Link>
        <Link href="/admin/pending" className={navClass(onPending)}>
          To approve
          {pendingCount > 0 && (
            <span
              className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: "rgba(0,0,0,0.35)", color: onPending ? "var(--accent)" : "#fbbf24" }}
            >
              {pendingCount}
            </span>
          )}
        </Link>
      </div>

      <h1 className="rise text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="rise mb-8 mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        {subtitle}
      </p>

      {children}
    </main>
  );
}

export function AdminDenied() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>
        This area is for Azalea administrators only.
      </p>
      <Link href="/account" className="btn btn-ghost mt-6">
        Back to account
      </Link>
    </main>
  );
}

export function AdminLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Logo size={36} className="animate-pulse" style={{ color: "var(--accent)" }} />
    </main>
  );
}
