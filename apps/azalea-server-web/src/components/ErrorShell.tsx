import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";

interface ErrorShellProps {
  code: string;
  title: string;
  message: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children?: React.ReactNode;
}

export function ErrorShell({
  code,
  title,
  message,
  primaryHref = "/",
  primaryLabel = "Back home",
  secondaryHref,
  secondaryLabel,
  children,
}: ErrorShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />

      <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <div
          className="pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "var(--accent-soft)" }}
          aria-hidden
        />

        <div className="rise relative z-10 max-w-lg">
          <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
            <Logo size={28} style={{ color: "var(--accent)" }} />
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Azalea
            </span>
          </Link>

          <p
            className="mb-3 font-mono text-sm uppercase tracking-[0.2em]"
            style={{ color: "var(--accent)" }}
          >
            {code}
          </p>

          <h1
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h1>

          <p className="mt-4 text-sm leading-relaxed md:text-base" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {children ?? (
              <>
                <Link href={primaryHref} className="btn btn-primary min-w-[10rem]">
                  {primaryLabel}
                </Link>
                {secondaryHref && secondaryLabel && (
                  <Link href={secondaryHref} className="btn btn-ghost min-w-[10rem]">
                    {secondaryLabel}
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
