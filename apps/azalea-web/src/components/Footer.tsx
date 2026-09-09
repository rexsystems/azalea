import Link from "next/link";
import { RELEASES_PAGE } from "@/lib/downloads";
import { GitHubIcon } from "./GitHubIcon";

const GITHUB_SOURCE = RELEASES_PAGE.replace("/releases/latest", "");
const REXSYSTEMS_URL = "https://rexsystems.me";
const REXSYSTEMS_LOGO = "https://cdn.694206767.xyz/rexsystems/logo-transparent.svg";

export function Footer() {
  return (
    <footer
      className="glass-surface relative z-20 border-t px-5 py-8 md:px-8"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 text-center text-xs sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <p style={{ color: "var(--text-muted)" }}>
          Azalea · {new Date().getFullYear()}
        </p>

        <nav className="flex flex-wrap items-center justify-center gap-5 sm:justify-end">
          <Link href="/download" className="nav-link text-xs">
            Download
          </Link>
          <Link href="/pricing" className="nav-link text-xs">
            Pricing
          </Link>
          <Link href="/#faq" className="nav-link text-xs">
            FAQ
          </Link>
          <Link href="/login" className="nav-link text-xs">
            Sign in
          </Link>
          <Link href="/signup" className="nav-link text-xs">
            Create account
          </Link>
          <a
            href={GITHUB_SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link inline-flex items-center gap-1.5 text-xs"
            aria-label="GitHub repository"
          >
            <GitHubIcon size={14} />
            GitHub
          </a>
          <a
            href={REXSYSTEMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center"
            aria-label="Rexsystems"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REXSYSTEMS_LOGO}
              alt="Rexsystems"
              className="h-5 w-auto max-h-5 opacity-50 grayscale brightness-125 transition-[opacity,filter] duration-200 group-hover:opacity-100 group-hover:grayscale-0 group-hover:brightness-100"
              draggable={false}
            />
          </a>
        </nav>
      </div>
    </footer>
  );
}
