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
  fileExtLabel,
  type LinuxDownloadOptions,
  type MacosDownloadOptions,
  type ReleaseAsset,
} from "@/lib/downloads";
import { CustomSelect } from "@/components/CustomSelect";

type PlatformDownload = { url: string; version: string | null; direct: boolean };

type LinuxFormatId = "rpm" | "deb" | "appimage";
type MacArchId = "arm64" | "x64";

function LinuxDownloadActions({ options }: { options: LinuxDownloadOptions }) {
  const versionLabel = formatReleaseVersion(options.version);

  const formats = [
    {
      id: "rpm" as const,
      label: "Fedora / RHEL / openSUSE",
      asset: options.rpm,
    },
    {
      id: "deb" as const,
      label: "Debian / Ubuntu",
      asset: options.deb,
    },
    {
      id: "appimage" as const,
      label: "Universal AppImage",
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
      <a href={RELEASES_PAGE} className="btn btn-primary w-full" rel="noopener noreferrer">
        <PlatformIcon platform="linux" size={16} />
        View releases
      </a>
    );
  }

  const current = formats.find((entry) => entry.id === selected) ?? formats[0];
  const ext = fileExtLabel(current.asset!.name);

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
        <span>Download {ext}</span>
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
  } else if (options.x64 && !options.arm64) {
    arches.push({ id: "x64", label: "Intel", asset: options.x64 });
  }

  const [selected, setSelected] = useState<MacArchId>("arm64");

  useEffect(() => {
    if (options.arm64) setSelected("arm64");
    else if (options.x64) setSelected("x64");
  }, [options.arm64, options.x64]);

  if (arches.length === 0) {
    return (
      <a href={RELEASES_PAGE} className="btn btn-primary w-full" rel="noopener noreferrer">
        <PlatformIcon platform="macos" size={16} />
        View releases
      </a>
    );
  }

  const current = arches.find((entry) => entry.id === selected) ?? arches[0];
  const ext = fileExtLabel(current.asset.name);

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
        <span>Download {ext}</span>
        {versionLabel ? <span className="linux-download-version">{versionLabel}</span> : null}
      </a>
    </div>
  );
}

function platformDescription(id: PlatformId, available: boolean): string {
  if (!available) return "Not shipping yet.";
  if (id === "linux") return "Choose .deb, .rpm, or AppImage.";
  if (id === "macos") return "Apple Silicon or Intel build.";
  if (id === "windows") return "Windows installer (.exe).";
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
      setWindowsDownload({ url: info.url, version: info.version, direct: info.direct });
    });

    void resolveLinuxDownloadOptions().then(setLinuxOptions);
    void resolveMacosDownloadOptions().then(setMacosOptions);
  }, []);

  const desktopPlatforms = PLATFORMS.filter(
    (p) => p.id === "windows" || p.id === "linux" || p.id === "macos",
  );
  const mobilePlatforms = PLATFORMS.filter((p) => p.id === "ios" || p.id === "android");

  return (
    <main className="min-h-screen">
      <SiteNav />

      <section className="mx-auto max-w-4xl px-5 py-12 md:py-16">
        <div className="mb-8 md:mb-10">
          <p
            className="mb-2 text-xs uppercase tracking-[0.18em]"
            style={{ color: "var(--text-muted)" }}
          >
            Install
          </p>
          <h1
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Download
          </h1>
          <p className="mt-2 text-sm md:text-base" style={{ color: "var(--text-secondary)" }}>
            Direct installers for Windows, Linux, and macOS.
            {windowsDownload?.version || linuxOptions?.version || macosOptions?.version ? (
              <>
                {" "}
                Latest{" "}
                <span style={{ color: "var(--text)" }}>
                  {formatReleaseVersion(
                    windowsDownload?.version || linuxOptions?.version || macosOptions?.version || null,
                  )}
                </span>
                .
              </>
            ) : null}
          </p>
        </div>

        <div className="space-y-2.5">
          {desktopPlatforms.map((platform) => {
            const isDetected = detected === platform.id;

            return (
              <div
                key={platform.id}
                className="download-row"
                data-detected={isDetected ? "true" : "false"}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="download-row-icon">
                      <PlatformIcon platform={platform.id} size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[0.95rem] font-medium">{platform.name}</h2>
                        {isDetected ? (
                          <span className="download-pill">Your device</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                        {platformDescription(platform.id, platform.available)}
                      </p>
                    </div>
                  </div>

                  <div className="w-full shrink-0 lg:max-w-none lg:w-auto lg:min-w-[28rem]">
                    {platform.id === "linux" ? (
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
                        className="btn btn-primary w-full"
                        rel="noopener noreferrer"
                      >
                        <PlatformIcon platform={platform.id} size={16} />
                        Download {fileExtLabel(windowsDownload.url)}
                        {windowsDownload.version ? (
                          <span className="text-xs opacity-70">
                            {formatReleaseVersion(windowsDownload.version)}
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <span className="btn btn-primary pointer-events-none w-full opacity-70">
                        <Loader2 size={16} className="animate-spin" />
                        Loading…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 space-y-2.5">
          <p
            className="mb-1 text-xs uppercase tracking-[0.18em]"
            style={{ color: "var(--text-muted)" }}
          >
            Coming later
          </p>
          {mobilePlatforms.map((platform) => (
            <div key={platform.id} className="download-row" data-detected="false">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="download-row-icon">
                    <PlatformIcon platform={platform.id} size={18} />
                  </div>
                  <div>
                    <h2 className="text-[0.95rem] font-medium">{platform.name}</h2>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Not available yet
                    </p>
                  </div>
                </div>
                <span className="download-unavailable">Soon</span>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Also on{" "}
          <a
            href={RELEASES_PAGE}
            className="underline underline-offset-2 transition-colors hover:text-white"
            style={{ color: "var(--text-secondary)" }}
          >
            GitHub Releases
          </a>
          . macOS builds are unsigned for Gatekeeper: right-click Open the first time.{" "}
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
