import Link from "next/link";
import { RELEASES_PAGE } from "@/lib/downloads";
import { DOCS_ROOT, DOCS_SELF_HOST } from "@/lib/docs";
import { GitHubIcon } from "./GitHubIcon";
import { Logo } from "./Logo";
import { NavDownloadLink } from "./NavDownloadLink";

const GITHUB_SOURCE = RELEASES_PAGE.replace("/releases/latest", "");

export function SiteNav() {
  return (
    <header className="glass-surface relative z-20 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 md:h-16 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={22} style={{ color: "var(--accent)" }} />
          <span
            className="text-base font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Azalea
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <a href="/#features" className="nav-link">
            Features
          </a>
          <Link href="/download" className="nav-link">
            Download
          </Link>
          <Link href="/self-host" className="nav-link">
            Self-host
          </Link>
          <a
            href={DOCS_ROOT}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            Docs
          </a>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={GITHUB_SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost px-2.5 py-2"
            aria-label="GitHub repository"
            title="GitHub"
          >
            <GitHubIcon size={18} />
          </a>
          <NavDownloadLink />
        </div>
      </div>
    </header>
  );
}

export { DOCS_SELF_HOST };
