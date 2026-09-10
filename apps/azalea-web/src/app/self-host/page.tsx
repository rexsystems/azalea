import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/Footer";
import { CopyCommand } from "@/components/CopyCommand";
import {
  DOCS_SELF_HOST,
  INSTALL_COMMAND,
  INSTALL_COMMAND_GITHUB,
} from "@/lib/docs";

const steps = [
  {
    title: "Run the installer",
    body: "Paste the command on a Linux VPS with a shell. It asks a few questions, writes Docker Compose, builds, and starts the server.",
  },
  {
    title: "Create your admin",
    body: "The script can bootstrap the first admin account, or you can do it later with the CLI inside the container.",
  },
  {
    title: "Connect the desktop app",
    body: "In Azalea, add a Self-hosted account, enter your instance URL, and sign in with email and password.",
  },
];

export default function SelfHostPage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <SiteNav />

      <section className="px-4 pb-10 pt-14 text-center sm:px-5 md:px-8 md:pb-16 md:pt-20">
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          azalea-server
        </p>
        <h1
          className="mx-auto max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Self-host sync
        </h1>
        <p
          className="mx-auto mt-4 max-w-xl text-base leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          Keep encrypted vault sync on hardware you control. Default port{" "}
          <span className="tabular-nums" style={{ color: "var(--text)" }}>
            9482
          </span>
          .
        </p>
      </section>

      <section className="px-4 pb-16 sm:px-5 md:px-8 md:pb-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-left text-sm font-medium" style={{ color: "var(--text)" }}>
            Install with this command
          </p>
          <CopyCommand command={INSTALL_COMMAND} />
          <p className="mt-4 text-left text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Or pull the installer straight from GitHub:
          </p>
          <div className="mt-2">
            <CopyCommand command={INSTALL_COMMAND_GITHUB} />
          </div>
        </div>
      </section>

      <section
        className="border-t px-4 py-16 sm:px-5 md:px-8 md:py-24"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-3xl">
          <h2
            className="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Three steps
          </h2>
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="glass-surface rounded-2xl px-5 py-4 text-left">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Step {i + 1}
                </p>
                <h3 className="mt-1 font-medium">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {step.body}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href={DOCS_SELF_HOST}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary px-6 py-3"
            >
              Go to docs
            </a>
            <Link href="/download" className="btn btn-ghost px-6 py-3">
              Download desktop app
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
