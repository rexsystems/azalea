"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { useEffect, useState } from "react";
import { getServerUpdateStatus } from "@/lib/admin-api";

interface AdminLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export function AdminLayout({ title, subtitle, children }: AdminLayoutProps) {
  const pathname = usePathname();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      void getServerUpdateStatus()
        .then((status) => {
          if (!cancelled)
            setUpdateAvailable(status.connected && status.available === true);
        })
        .catch(() => {});
    check();
    const timer = window.setInterval(check, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link href="/account" className="admin-brand">
          <Logo size={22} style={{ color: "var(--accent)" }} />
          <span>Azalea</span>
        </Link>
        <nav className="admin-nav">
          <Link
            href="/admin"
            className={`btn ${pathname === "/admin" ? "btn-primary" : "btn-ghost"} px-3 py-1.5 text-sm`}
            aria-current={pathname === "/admin" ? "page" : undefined}
          >
            Dashboard
          </Link>
          <Link
            href="/admin/settings"
            className={`btn ${pathname === "/admin/settings" ? "btn-primary" : "btn-ghost"} px-3 py-1.5 text-sm`}
            aria-current={pathname === "/admin/settings" ? "page" : undefined}
          >
            Instance
          </Link>
          <Link
            href="/admin/ai"
            className={`btn ${pathname === "/admin/ai" ? "btn-primary" : "btn-ghost"} px-3 py-1.5 text-sm`}
            aria-current={pathname === "/admin/ai" ? "page" : undefined}
          >
            AI
          </Link>
          <Link href="/account" className="btn btn-ghost px-3 py-1.5 text-sm">
            Account
          </Link>
          <Link
            href="/admin/updates"
            className={`btn ${pathname === "/admin/updates" ? "btn-primary" : "btn-ghost"} px-3 py-1.5 text-sm`}
            aria-current={pathname === "/admin/updates" ? "page" : undefined}
          >
            Updates
          </Link>
        </nav>
      </header>

      {updateAvailable && pathname !== "/admin/updates" && (
        <Link href="/admin/updates" className="rex-hint">
          New server or dashboard update available →
        </Link>
      )}

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
      <p
        className="mt-2 max-w-sm text-sm"
        style={{ color: "var(--text-muted)" }}
      >
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
      <Logo
        size={36}
        className="animate-pulse"
        style={{ color: "var(--accent)" }}
      />
    </main>
  );
}
