"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PlatformIcon } from "@/components/PlatformIcon";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/Footer";
import {
  detectPlatform,
  preferredLinuxPackageFormat,
  rememberLinuxPackageFormat,
  PLATFORMS,
  type PlatformId,
  type LinuxPackageFormat,
} from "@/lib/platform";
import {
  RELEASES_PAGE,
  resolveLinuxDownloadOptions,
  resolveMacosDownloadOptions,
  resolveWindowsDownload,
  formatReleaseVersion,
  type LinuxDownloadOptions,
  type MacosDownloadOptions,
  type ReleaseAsset,
} from "@/lib/downloads";
import { CustomSelect } from "@/components/CustomSelect";

type PlatformDownload = { url: string; version: string | null };

type LinuxFormatId = "rpm" | "deb" | "appimage";
type MacArchId = "arm64" | "x64";

function LinuxDownloadActions({
  options,
}: {
  options: LinuxDownloadOptions;
}) {
  const versionLabel = formatReleaseVersion(options.version);

  const formats = [
    {
      id: "rpm" as const,
      label: "Fedora / RHEL / openSUSE",
      ext: ".rpm",
      asset: options.rpm,
    },
    {
      id: "deb" as const,
      label: "Debian / Ubuntu",
      ext: ".deb",
      asset: options.deb,
    },
    {
      id: "appimage" as const,
      label: "Universal AppImage",
      ext: ".AppImage",
      asset: options.appimage,
    },
  ].filter((entry) => entry.asset);

  const [selected, setSelected] = useState<LinuxFormatId>("deb");

  useEffect(() => {
    const preferred = preferredLinuxPackageFormat();
    const pick = (id: LinuxFormatId) => {
      if (id === "rpm" && options.rpm) return "rpm";
      if (id === "deb" && options.deb) return "deb";
      if (id === "appimage" && options.appimage) return "appimage";
      return null;
    };

    const fromPreferred = pick(preferred);
    if (fromPreferred) {
      setSelected(fromPreferred);
      return;
    }
    if (options.deb) setSelected("deb");
    else if (options.rpm) setSelected("rpm");
    else if (options.appimage) setSelected("appimage");
  }, [options.rpm, options.deb, options.appimage]);

  const onSelectFormat = (value: string) => {
    const next = value as LinuxPackageFormat;
    setSelected(next);
    rememberLinuxPackageFormat(next);
  };

  if (formats.length === 0) {
    return (
      <a href={RELEASES_PAGE} className="btn btn-primary w-full sm:w-auto" rel="noopener noreferrer">
        <PlatformIcon platform="linux" size={16} />
        View releases
      </a>
    );
  }

  const current = formats.find((entry) => entry.id === selected) ?? formats[0];

  return (
    <div className="linux-download-bar">
      {formats.length > 1 ? (
        <CustomSelect
          value={selected}
          ariaLabel="Linux package format"
          options={formats.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={onSelectFormat}
        />
      ) : null}

      <a
        href={current.asset!.browser_download_url}
        className="btn btn-primary linux-download-btn"
        rel="noopener noreferrer"
      >
        <PlatformIcon platform="linux" size={16} />
        <span>Download {current.ext}</span>
        {versionLabel ? <span className="linux-download-version">{versionLabel}</span> : null}
      </a>
    </div>
  );
}

function MacosDownloadActions({ options }: { options: MacosDownloadOptions }) {
  const versionLabel = formatReleaseVersion(options.version);

  const arches: { id: MacArchId; label: string; asset: ReleaseAsset }[] = [];
  if (options.arm64) {
    arches.push({ id: "arm64", label: "Apple Silicon", asset: options.arm64 });
  }
  if (options.x64 && options.x64.name !== options.arm64?.name) {
    arches.push({ id: "x64", label: "Intel", asset: options.x64 });
  }

  const [selected, setSelected] = useState<MacArchId>("arm64");

  useEffect(() => {
    if (options.arm64) setSelected("arm64");
    else if (options.x64) setSelected("x64");
  }, [options.arm64, options.x64]);

  if (arches.length === 0) {
    return (
      <a href={RELEASES_PAGE} className="btn btn-primary w-full sm:w-auto" rel="noopener noreferrer">
        <PlatformIcon platform="macos" size={16} />
        View releases
      </a>
    );
  }

  const current = arches.find((entry) => entry.id === selected) ?? arches[0];

  return (
    <div className="linux-download-bar">
      {arches.length > 1 ? (
        <CustomSelect
          value={selected}
          ariaLabel="Mac architecture"
          options={arches.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={setSelected}
        />
      ) : null}

      <a
        href={current.asset.browser_download_url}
        className="btn btn-primary linux-download-btn"
        rel="noopener noreferrer"
      >
        <PlatformIcon platform="macos" size={16} />
        <span>Download .dmg</span>
        {versionLabel ? <span className="linux-download-version">{versionLabel}</span> : null}
      </a>
    </div>
  );
}

function platformDescription(id: PlatformId, available: boolean): string {
  if (!available) return "Currently unavailable.";
  if (id === "linux") return "Pick a package format for your distro, then download.";
  if (id === "macos") return "Pick Apple Silicon or Intel, then download the DMG.";
  return "Ready to install.";
}

export default function DownloadPage() {
  const [detected, setDetected] = useState<PlatformId | null>(null);
  const [windowsDownload, setWindowsDownload] = useState<PlatformDownload | null>(null);
  const [linuxOptions, setLinuxOptions] = useState<LinuxDownloadOptions | null>(null);
  const [macosOptions, setMacosOptions] = useState<MacosDownloadOptions | null>(null);

  useEffect(() => {
    setDetected(detectPlatform());

    void resolveWindowsDownload().then((info) => {
      setWindowsDownload({ url: info.url, version: info.version });
    });

    void resolveLinuxDownloadOptions().then(setLinuxOptions);
    void resolveMacosDownloadOptions().then(setMacosOptions);
  }, []);

  return (
    <main className="min-h-screen">
      <SiteNav />

      <section className="mx-auto max-w-2xl px-5 py-14 md:py-20">
        <div className="mb-10 text-center">
          <h1
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Download Azalea
          </h1>
          <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
            Windows, Linux, and macOS.
          </p>
        </div>

        <div className="space-y-3">
          {PLATFORMS.map((platform) => {
            const isDetected = detected === platform.id;

            return (
              <div
                key={platform.id}
                className="rounded-xl border p-4 md:p-5"
                style={{
                  borderColor: isDetected ? "var(--border-strong)" : "var(--border)",
                  background: isDetected ? "var(--bg-panel)" : "var(--bg-raised)",
                }}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
                      style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
                    >
                      <PlatformIcon platform={platform.id} size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{platform.name}</h2>
                        {isDetected && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                            style={{
                              border: "1px solid var(--border-strong)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            your device
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        {platformDescription(platform.id, platform.available)}
                      </p>
                    </div>
                  </div>

                  <div className="w-full">
                    {platform.available ? (
                      platform.id === "linux" ? (
                        linuxOptions ? (
                          <LinuxDownloadActions options={linuxOptions} />
                        ) : (
                          <span className="btn btn-primary pointer-events-none w-full opacity-70">
                            <Loader2 size={16} className="animate-spin" />
                            Loading…
                          </span>
                        )
                      ) : platform.id === "macos" ? (
                        macosOptions ? (
                          <MacosDownloadActions options={macosOptions} />
                        ) : (
                          <span className="btn btn-primary pointer-events-none w-full opacity-70">
                            <Loader2 size={16} className="animate-spin" />
                            Loading…
                          </span>
                        )
                      ) : windowsDownload ? (
                        <a
                          href={windowsDownload.url}
                          className="btn btn-primary w-full sm:w-auto"
                          rel="noopener noreferrer"
                        >
                          <PlatformIcon platform={platform.id} size={16} />
                          Download
                          {windowsDownload.version && (
                            <span className="text-xs opacity-70">
                              {formatReleaseVersion(windowsDownload.version)}
                            </span>
                          )}
                        </a>
                      ) : (
                        <span className="btn btn-primary pointer-events-none w-full opacity-70 sm:w-auto">
                          <Loader2 size={16} className="animate-spin" />
                          Loading…
                        </span>
                      )
                    ) : (
                      <span
                        className="inline-flex w-full items-center justify-center rounded-xl border px-4 py-2.5 text-sm sm:w-auto"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-muted)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        Currently unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Installers are also on{" "}
          <a
            href={RELEASES_PAGE}
            className="underline transition-colors hover:text-white"
            style={{ color: "var(--text-secondary)" }}
          >
            GitHub Releases
          </a>
          . macOS builds are unsigned for Gatekeeper — right-click the app and choose Open the first
          time.{" "}
          <Link
            href="/"
            className="transition-colors hover:text-white"
            style={{ color: "var(--text-secondary)" }}
          >
            Back home
          </Link>
        </p>
      </section>

      <Footer />
    </main>
  );
}
