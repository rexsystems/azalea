import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/Footer";
import { DownloadButton, PlatformAvailabilityNote } from "@/components/DownloadButton";
import { AppPreview } from "@/components/AppPreview";
import { CopyCommand } from "@/components/CopyCommand";
import { JsonLd, softwareApplicationLd, websiteLd, faqLd } from "@/components/JsonLd";
import { DOCS_ROOT, DOCS_SELF_HOST, INSTALL_COMMAND } from "@/lib/docs";

const features = [
  {
    title: "SSH terminal that stays fast",
    body: "Multi-tab SSH sessions, splits, snippets, and a terminal built for daily remote work on Windows, Linux, and macOS.",
  },
  {
    title: "SFTP and port forwarding",
    body: "Browse remote files, upload and download, and set up local or remote port forwards without leaving the app.",
  },
  {
    title: "SSH keys stay on your machine",
    body: "Generate or import keys, install public keys on hosts, and keep passwords in secure storage instead of plaintext configs.",
  },
  {
    title: "Local terminal included",
    body: "Keep a local shell open next to your SSH sessions in one workspace when you need both.",
  },
];

const faqs = [
  {
    question: "What is Azalea?",
    answer:
      "Azalea is an open-source SSH client and terminal for Windows, Linux, and macOS. It includes multi-tab SSH sessions, SFTP, port forwarding, SSH key management, a local terminal, and optional encrypted sync.",
  },
  {
    question: "Is Azalea free?",
    answer:
      "Yes. The desktop app is free and open source under AGPL-3.0. Sync can use Azalea Cloud or your own self-hosted azalea-server.",
  },
  {
    question: "How do I self-host sync?",
    answer:
      "Run the one-line installer on a VPS, then connect the desktop app to your instance. Full steps are in the self-host docs.",
  },
  {
    question: "Where are my SSH keys stored?",
    answer:
      "Private keys and passwords stay on your device in secure storage. Optional sync only uploads ciphertext encrypted with your master passphrase.",
  },
  {
    question: "Which platforms does Azalea support?",
    answer:
      "Windows, Linux (.deb, .rpm, AppImage), and macOS. Grab installers from the download page.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <JsonLd data={softwareApplicationLd()} />
      <JsonLd data={websiteLd()} />
      <JsonLd data={faqLd(faqs)} />
      <SiteNav />

      <section className="relative overflow-x-hidden px-4 pb-16 pt-14 text-center sm:px-5 md:px-8 md:pb-28 md:pt-24">
        <p className="rise mb-5 text-sm" style={{ color: "var(--text-muted)" }}>
          Open-source SSH client for Windows, Linux, and macOS
        </p>

        <h1
          className="rise delay-1 mx-auto max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-4xl md:text-6xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Azalea
          <span className="mt-2 block text-[0.72em] font-medium tracking-tight sm:mt-3">
            Modern SSH terminal for your servers
          </span>
        </h1>

        <p
          className="rise delay-2 mx-auto mt-5 max-w-xl text-base leading-relaxed md:text-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          Fast SSH connections, SFTP, key management, and encrypted sync in one workspace built for
          people who live in the terminal.
        </p>

        <div className="rise delay-3 mt-8 flex w-full max-w-sm flex-col items-stretch gap-3 sm:mt-10 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
          <DownloadButton className="w-full px-6 py-3.5 text-[0.9375rem] sm:w-auto sm:px-8" />
          <Link href="/self-host" className="btn btn-ghost w-full px-6 py-3.5 sm:w-auto sm:px-8">
            Self-host
          </Link>
        </div>
        <div className="rise delay-3 mt-3">
          <PlatformAvailabilityNote />
        </div>

        <div className="mt-16 sm:mt-20 md:mt-44 lg:mt-52">
          <AppPreview />
        </div>
      </section>

      <section
        id="features"
        className="border-t px-4 py-16 sm:px-5 md:px-8 md:py-28"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-5xl">
          <h2
            className="mb-3 text-center text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Built for daily SSH work
          </h2>
          <p
            className="mx-auto mb-8 max-w-2xl text-center text-sm md:mb-12"
            style={{ color: "var(--text-muted)" }}
          >
            Tabs, SFTP, keys, port forwards, and sync without the clutter.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((item) => (
              <div key={item.title} className="glass-surface rounded-2xl p-6">
                <h3 className="mb-2 font-medium">{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="self-host"
        className="border-t px-4 py-16 sm:px-5 md:px-8 md:py-28"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-sm uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>
            Self-host
          </p>
          <h2
            className="text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Run sync on your own server
          </h2>
          <p
            className="mx-auto mt-4 max-w-xl text-sm leading-relaxed md:text-base"
            style={{ color: "var(--text-secondary)" }}
          >
            One command installs azalea-server with Docker. Connect the desktop app to your instance
            when you want encrypted sync without our cloud.
          </p>
          <div className="mx-auto mt-8 max-w-2xl">
            <CopyCommand command={INSTALL_COMMAND} />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/self-host" className="btn btn-primary px-6 py-3">
              Self-host guide
            </Link>
            <a
              href={DOCS_SELF_HOST}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost px-6 py-3"
            >
              Full docs
            </a>
          </div>
        </div>
      </section>

      <section
        id="faq"
        className="border-t px-4 py-16 sm:px-5 md:px-8 md:py-28"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-3xl">
          <h2
            className="mb-8 text-center text-2xl font-semibold tracking-tight md:mb-10 md:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            FAQ
          </h2>
          <div className="space-y-4">
            {faqs.map((item) => (
              <details key={item.question} className="glass-surface group rounded-2xl px-5 py-4">
                <summary className="cursor-pointer list-none font-medium outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {item.question}
                    <span
                      className="shrink-0 text-lg leading-none transition group-open:rotate-45"
                      style={{ color: "var(--text-muted)" }}
                      aria-hidden
                    >
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            More in the{" "}
            <a
              href={DOCS_ROOT}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: "var(--text)" }}
            >
              docs
            </a>
            .
          </p>
        </div>
      </section>

      <section
        className="border-t px-4 py-16 text-center sm:px-5 md:px-8 md:py-24"
        style={{ borderColor: "var(--border)" }}
      >
        <h2
          className="text-2xl font-semibold tracking-tight md:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Ready to connect?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm" style={{ color: "var(--text-muted)" }}>
          Download Azalea and import your hosts in minutes.
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col items-stretch gap-3 sm:mx-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
          <DownloadButton className="w-full px-6 py-3.5 sm:w-auto sm:px-8" />
          <Link href="/download" className="btn btn-ghost w-full px-6 py-3.5 sm:w-auto sm:px-8">
            All platforms
          </Link>
        </div>
        <div className="mt-3">
          <PlatformAvailabilityNote />
        </div>
      </section>

      <Footer />
    </main>
  );
}
