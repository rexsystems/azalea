"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";

interface AdminLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export function AdminLayout({ title, subtitle, children }: AdminLayoutProps) {
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link href="/account" className="admin-brand">
          <Logo size={22} style={{ color: "var(--accent)" }} />
          <span>Azalea</span>
        </Link>
        <nav className="admin-nav">
          <Link href="/admin" className="btn btn-primary px-3 py-1.5 text-sm">
            Dashboard
          </Link>
          <Link href="/account" className="btn btn-ghost px-3 py-1.5 text-sm">
            Account
          </Link>
        </nav>
      </header>

      <div className="admin-heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {children}
    </main>
  );
}

export function AdminDenied() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>
        This area is for administrators only.
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
