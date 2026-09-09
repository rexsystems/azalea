import type { LinuxPackageFormat } from "@/lib/platform";

export const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO ?? "rexsystems/azalea";

export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

/** Optional override when the desktop repo is private or API is unavailable. */
export const WINDOWS_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL ?? null;

export const LINUX_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_LINUX_DOWNLOAD_URL ?? null;

export const MACOS_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_MACOS_DOWNLOAD_URL ?? null;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

const WIN_INSTALLER = /\.(exe|msi)$/i;
const LINUX_INSTALLER = /\.(AppImage|appimage|deb|rpm)$/i;
const MAC_INSTALLER = /\.(dmg|pkg)$/i;

export function pickMacosAsset(
  assets: ReleaseAsset[],
  arch?: "arm64" | "x64" | null,
): ReleaseAsset | null {
  const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name));
  if (dmgs.length === 0) {
    return assets.find((a) => MAC_INSTALLER.test(a.name)) ?? null;
  }

  const arm = dmgs.find((a) => /aarch64|arm64|apple.?silicon/i.test(a.name));
  const intel = dmgs.find((a) => /x64|x86_64|intel/i.test(a.name));

  if (arch === "arm64") return arm ?? dmgs[0];
  if (arch === "x64") return intel ?? dmgs[0];
  return arm ?? intel ?? dmgs[0];
}

export function pickWindowsAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  return (
    assets.find((a) => /setup|installer/i.test(a.name) && WIN_INSTALLER.test(a.name)) ??
    assets.find((a) => WIN_INSTALLER.test(a.name)) ??
    null
  );
}

export function pickLinuxAsset(
  assets: ReleaseAsset[],
  format?: LinuxPackageFormat | null,
): ReleaseAsset | null {
  if (format === "rpm") {
    return assets.find((a) => /\.rpm$/i.test(a.name)) ?? null;
  }
  if (format === "deb") {
    return assets.find((a) => /\.deb$/i.test(a.name)) ?? null;
  }
  if (format === "appimage") {
    return (
      assets.find((a) => /appimage/i.test(a.name) && LINUX_INSTALLER.test(a.name)) ?? null
    );
  }

  return (
    assets.find((a) => /\.deb$/i.test(a.name)) ??
    assets.find((a) => /\.rpm$/i.test(a.name)) ??
    assets.find((a) => /appimage/i.test(a.name) && LINUX_INSTALLER.test(a.name)) ??
    assets.find((a) => LINUX_INSTALLER.test(a.name)) ??
    null
  );
}

export function formatReleaseVersion(tag: string | null): string | null {
  if (!tag) return null;
  return tag.startsWith("v") ? tag : `v${tag}`;
}

export async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error("release lookup failed");
    return (await res.json()) as GitHubRelease;
  } catch {
    return null;
  }
}

export async function resolveWindowsDownload(): Promise<{
  url: string;
  version: string | null;
  direct: boolean;
}> {
  if (WINDOWS_DOWNLOAD_URL) {
    return { url: WINDOWS_DOWNLOAD_URL, version: null, direct: true };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { url: RELEASES_PAGE, version: null, direct: false };
  }

  const asset = pickWindowsAsset(release.assets);
  if (asset) {
    return { url: asset.browser_download_url, version: release.tag_name, direct: true };
  }
  return { url: release.html_url, version: release.tag_name, direct: false };
}

export async function resolveLinuxDownload(
  format?: LinuxPackageFormat | null,
): Promise<{
  url: string;
  version: string | null;
  direct: boolean;
}> {
  if (LINUX_DOWNLOAD_URL) {
    return { url: LINUX_DOWNLOAD_URL, version: null, direct: true };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { url: RELEASES_PAGE, version: null, direct: false };
  }

  const asset = pickLinuxAsset(release.assets, format);
  if (asset) {
    return { url: asset.browser_download_url, version: release.tag_name, direct: true };
  }
  return { url: release.html_url, version: release.tag_name, direct: false };
}

export async function resolveMacosDownload(
  arch?: "arm64" | "x64" | null,
): Promise<{
  url: string;
  version: string | null;
  direct: boolean;
}> {
  if (MACOS_DOWNLOAD_URL) {
    return { url: MACOS_DOWNLOAD_URL, version: null, direct: true };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { url: RELEASES_PAGE, version: null, direct: false };
  }

  const asset = pickMacosAsset(release.assets, arch);
  if (asset) {
    return { url: asset.browser_download_url, version: release.tag_name, direct: true };
  }
  return { url: release.html_url, version: release.tag_name, direct: false };
}

export interface LinuxDownloadOptions {
  rpm: ReleaseAsset | null;
  deb: ReleaseAsset | null;
  appimage: ReleaseAsset | null;
  version: string | null;
}

export interface MacosDownloadOptions {
  arm64: ReleaseAsset | null;
  x64: ReleaseAsset | null;
  version: string | null;
}

export async function resolveLinuxDownloadOptions(): Promise<LinuxDownloadOptions> {
  const release = await fetchLatestRelease();
  if (!release) {
    return { rpm: null, deb: null, appimage: null, version: null };
  }

  return {
    rpm: pickLinuxAsset(release.assets, "rpm"),
    deb: pickLinuxAsset(release.assets, "deb"),
    appimage: pickLinuxAsset(release.assets, "appimage"),
    version: release.tag_name,
  };
}

export async function resolveMacosDownloadOptions(): Promise<MacosDownloadOptions> {
  const release = await fetchLatestRelease();
  if (!release) {
    return { arm64: null, x64: null, version: null };
  }

  return {
    arm64: pickMacosAsset(release.assets, "arm64"),
    x64: pickMacosAsset(release.assets, "x64"),
    version: release.tag_name,
  };
}
