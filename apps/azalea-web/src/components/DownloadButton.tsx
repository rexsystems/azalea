"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  detectPlatform,
  preferredLinuxPackageFormat,
  isPlatformAvailable,
  platformLabel,
  type PlatformId,
} from "@/lib/platform";
import {
  RELEASES_PAGE,
  resolveLinuxDownload,
  resolveMacosDownload,
  resolveWindowsDownload,
  formatReleaseVersion,
} from "@/lib/downloads";

interface DownloadButtonProps {
  className?: string;
  variant?: "primary" | "ghost";
}

function resolvePlatformDownload(platform: PlatformId) {
  if (platform === "linux") return resolveLinuxDownload(preferredLinuxPackageFormat());
  if (platform === "macos") return resolveMacosDownload("arm64");
  return resolveWindowsDownload();
}

export function DownloadButton({ className = "", variant = "primary" }: DownloadButtonProps) {
  const [platform, setPlatform] = useState<PlatformId | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [href, setHref] = useState(RELEASES_PAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    const active = platform ?? "windows";
    if (!isPlatformAvailable(active)) {
      setReady(true);
      return;
    }

    let cancelled = false;
    void resolvePlatformDownload(active).then((info) => {
      if (cancelled) return;
      setHref(info.url);
      setVersion(info.version);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const active = platform ?? "windows";
  const available = isPlatformAvailable(active);
  const btnClass = `btn ${variant === "primary" ? "btn-primary" : "btn-ghost"} ${className}`;

  if (!ready) {
    return (
      <span className={`${btnClass} pointer-events-none opacity-80`}>
        <Loader2 size={17} className="animate-spin" />
        Download
      </span>
    );
  }

  if (available && (active === "windows" || active === "linux" || active === "macos")) {
    return (
      <a href={href} className={btnClass} rel="noopener noreferrer">
        <PlatformIcon platform={active} size={17} />
        Download for {platformLabel(active)}
        {version && (
          <span className="text-xs opacity-60" style={{ fontWeight: 400 }}>
            {formatReleaseVersion(version)}
          </span>
        )}
      </a>
    );
  }

  return (
    <Link href="/download" className={btnClass}>
      <PlatformIcon platform={active} size={17} />
      Not available on {platformLabel(active)}
    </Link>
  );
}

export function PlatformAvailabilityNote({ className = "" }: { className?: string }) {
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const active = platform ?? "windows";
  const available = isPlatformAvailable(active);

  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <div
        className="flex items-center justify-center gap-2 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <PlatformIcon platform={active} size={15} />
        <span>
          {available
            ? `Available on ${platformLabel(active)}`
            : `${platformLabel(active)} is currently unavailable`}
        </span>
      </div>
      <Link
        href="/download"
        className="text-xs transition-colors hover:text-white"
        style={{ color: "var(--text-secondary)" }}
      >
        Go to downloads page
      </Link>
    </div>
  );
}
