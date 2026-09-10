import type { LinuxPackageFormat } from "@/lib/platform";

export const GITHUB_REPO =
  process.env.NEXT_PUBLIC_GITHUB_REPO?.trim() || "rexsystems/azalea";

export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

/** Optional override when the desktop repo is private or API is unavailable. */
export const WINDOWS_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL?.trim() || null;

export const LINUX_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_LINUX_DOWNLOAD_URL?.trim() || null;

export const MACOS_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_MACOS_DOWNLOAD_URL?.trim() || null;

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

interface UpdaterPlatform {
  url: string;
  signature?: string;
}

interface UpdaterManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, UpdaterPlatform>;
}

const WIN_INSTALLER = /\.(exe|msi)$/i;
const LINUX_INSTALLER = /\.(AppImage|appimage|deb|rpm)$/i;
const MAC_INSTALLER = /\.(dmg|pkg|tar\.gz)$/i;

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || "download");
  } catch {
    return "download";
  }
}

function assetFromUrl(url: string): ReleaseAsset {
  return { name: filenameFromUrl(url), browser_download_url: url };
}

function tagFromVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function versionNumber(version: string): string {
  return version.replace(/^v/i, "");
}

/** User-facing macOS installers (DMG). Updater uses .app.tar.gz in latest.json. */
function macosDmgUrl(version: string, arch: "arm64" | "x64"): string {
  const v = versionNumber(version);
  const suffix = arch === "arm64" ? "aarch64" : "x86_64";
  return `https://github.com/${GITHUB_REPO}/releases/latest/download/Azalea_${v}_${suffix}.dmg`;
}

function macosDmgAsset(version: string, arch: "arm64" | "x64"): ReleaseAsset {
  const url = macosDmgUrl(version, arch);
  return { name: filenameFromUrl(url), browser_download_url: url };
}

/** Prefer local updater manifest (same-origin, no GitHub API rate limit). */
export async function fetchUpdaterManifest(): Promise<UpdaterManifest | null> {
  try {
    const res = await fetch("/updates/latest.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UpdaterManifest;
  } catch {
    return null;
  }
}

export function pickMacosAsset(
  assets: ReleaseAsset[],
  arch?: "arm64" | "x64" | null,
): ReleaseAsset | null {
  const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name));
  const pool = dmgs.length > 0 ? dmgs : assets.filter((a) => MAC_INSTALLER.test(a.name));
  if (pool.length === 0) return null;

  const arm = pool.find((a) => /aarch64|arm64|apple.?silicon/i.test(a.name));
  const intel = pool.find((a) => /x64|x86_64|intel/i.test(a.name));

  if (arch === "arm64") return arm ?? pool[0];
  if (arch === "x64") return intel ?? pool[0];
  return arm ?? intel ?? pool[0];
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

/** Pretty label: `v0.1.1-build.49` → `v0.1.1 (build 49)`. */
export function formatReleaseVersion(tag: string | null): string | null {
  if (!tag) return null;
  const cleaned = tag.trim();
  const buildMatch = cleaned.match(/^v?(\d+\.\d+\.\d+)(?:-build[.-]?(\d+))?$/i);
  if (buildMatch) {
    return buildMatch[2]
      ? `v${buildMatch[1]} (build ${buildMatch[2]})`
      : `v${buildMatch[1]}`;
  }
  const nameMatch = cleaned.match(/v?(\d+\.\d+\.\d+).*?\b(?:build)\s*[#.]?\s*(\d+)/i);
  if (nameMatch) {
    return `v${nameMatch[1]} (build ${nameMatch[2]})`;
  }
  return cleaned.startsWith("v") ? cleaned : `v${cleaned}`;
}

function assetsFromManifest(manifest: UpdaterManifest): ReleaseAsset[] {
  return Object.values(manifest.platforms)
    .map((p) => p?.url)
    .filter((url): url is string => Boolean(url))
    .map(assetFromUrl);
}

/** GitHub release tag includes CI build (e.g. v0.1.1-build.49). latest.json does not. */
let githubMetaPromise: Promise<{ tag_name: string; name: string } | null> | null = null;

async function fetchGithubReleaseMeta(): Promise<{
  tag_name: string;
  name: string;
} | null> {
  if (!githubMetaPromise) {
    githubMetaPromise = (async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
          { headers: { Accept: "application/vnd.github+json" } },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { tag_name?: string; name?: string };
        if (!data.tag_name) return null;
        return { tag_name: data.tag_name, name: data.name || data.tag_name };
      } catch {
        return null;
      }
    })();
  }
  return githubMetaPromise;
}

async function resolveDisplayVersion(fallback: string | null): Promise<string | null> {
  const meta = await fetchGithubReleaseMeta();
  return meta?.tag_name ?? fallback;
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  const manifest = await fetchUpdaterManifest();
  const github = await fetchGithubReleaseMeta();

  if (manifest?.platforms) {
    return {
      tag_name: github?.tag_name ?? tagFromVersion(manifest.version),
      name: github?.name ?? manifest.notes ?? `Azalea ${manifest.version}`,
      html_url: RELEASES_PAGE,
      assets: assetsFromManifest(manifest),
    };
  }

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

  const manifest = await fetchUpdaterManifest();
  if (manifest?.platforms?.["windows-x86_64"]?.url) {
    return {
      url: manifest.platforms["windows-x86_64"].url,
      version: await resolveDisplayVersion(tagFromVersion(manifest.version)),
      direct: true,
    };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { url: RELEASES_PAGE, version: null, direct: false };
  }

  const asset = pickWindowsAsset(release.assets);
  if (asset) {
    return { url: asset.browser_download_url, version: release.tag_name, direct: true };
  }
  return { url: RELEASES_PAGE, version: release.tag_name, direct: false };
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
  return { url: RELEASES_PAGE, version: release.tag_name, direct: false };
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

  const preferred = arch === "x64" ? "x64" : "arm64";
  const manifest = await fetchUpdaterManifest();
  if (manifest?.version) {
    return {
      url: macosDmgUrl(manifest.version, preferred),
      version: await resolveDisplayVersion(tagFromVersion(manifest.version)),
      direct: true,
    };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { url: RELEASES_PAGE, version: null, direct: false };
  }

  const asset = pickMacosAsset(
    release.assets.filter((a) => /\.dmg$/i.test(a.name)),
    preferred,
  );
  if (asset) {
    return { url: asset.browser_download_url, version: release.tag_name, direct: true };
  }
  return { url: RELEASES_PAGE, version: release.tag_name, direct: false };
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
  const manifest = await fetchUpdaterManifest();
  if (manifest?.platforms) {
    return {
      rpm: manifest.platforms["linux-x86_64-rpm"]?.url
        ? assetFromUrl(manifest.platforms["linux-x86_64-rpm"].url)
        : null,
      deb: manifest.platforms["linux-x86_64-deb"]?.url
        ? assetFromUrl(manifest.platforms["linux-x86_64-deb"].url)
        : null,
      appimage: manifest.platforms["linux-x86_64"]?.url
        ? assetFromUrl(manifest.platforms["linux-x86_64"].url)
        : null,
      version: await resolveDisplayVersion(tagFromVersion(manifest.version)),
    };
  }

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
  const manifest = await fetchUpdaterManifest();
  if (manifest?.version) {
    return {
      arm64: macosDmgAsset(manifest.version, "arm64"),
      x64: macosDmgAsset(manifest.version, "x64"),
      version: await resolveDisplayVersion(tagFromVersion(manifest.version)),
    };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { arm64: null, x64: null, version: null };
  }

  const dmgs = release.assets.filter((a) => /\.dmg$/i.test(a.name));
  return {
    arm64: pickMacosAsset(dmgs, "arm64"),
    x64: pickMacosAsset(dmgs, "x64"),
    version: release.tag_name,
  };
}

export function fileExtLabel(nameOrUrl: string): string {
  const name = nameOrUrl.includes("/") ? filenameFromUrl(nameOrUrl) : nameOrUrl;
  if (/\.exe$/i.test(name)) return ".exe";
  if (/\.msi$/i.test(name)) return ".msi";
  if (/\.deb$/i.test(name)) return ".deb";
  if (/\.rpm$/i.test(name)) return ".rpm";
  if (/appimage/i.test(name)) return ".AppImage";
  if (/\.dmg$/i.test(name)) return ".dmg";
  if (/\.pkg$/i.test(name)) return ".pkg";
  if (/\.tar\.gz$/i.test(name)) return ".tar.gz";
  return "installer";
}
