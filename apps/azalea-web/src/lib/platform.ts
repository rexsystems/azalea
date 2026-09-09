export type LinuxPackageFormat = "rpm" | "deb" | "appimage";

const LINUX_PKG_STORAGE_KEY = "azalea-linux-pkg";

/** Distro names that sometimes appear in browser UAs (often stripped nowadays). */
const RPM_DISTRO_UA =
  /Fedora|Nobara|RHEL|Red Hat|CentOS|Rocky|Alma(?:Linux)?|openSUSE|SUSE|Mageia|ROSA|ALT Linux|Ultramarine|Bluefin|Aurora|Bazzite|Kinoite|Silverblue/i;
const DEB_DISTRO_UA =
  /Debian|Ubuntu|Mint|Pop!_OS|elementary|Zorin|Kubuntu|Xubuntu|Lubuntu|KDE neon|Deepin|Uos|Linux Mint|Parrot|Kali|Peppermint|MX Linux|Devuan|Trisquel|Raspbian|Raspberry Pi OS|Armbian|Linux Lite|antiX|Bodhi/i;

/** Best-effort Linux package format from the browser UA (null when unknown). */
export function detectLinuxPackageFormat(): LinuxPackageFormat | null {
  if (typeof navigator === "undefined") return null;

  const haystack = [navigator.userAgent, navigator.platform, navigator.vendor]
    .filter(Boolean)
    .join(" ");

  // Check Debian-family first: some RPM UAs are rarer, and "Linux" alone must not win.
  if (DEB_DISTRO_UA.test(haystack)) return "deb";
  if (RPM_DISTRO_UA.test(haystack)) return "rpm";
  return null;
}

/**
 * Format to preselect for downloads.
 * Order: remembered choice → UA hint → deb (majority of desktop Linux) → null.
 */
export function preferredLinuxPackageFormat(): LinuxPackageFormat {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(LINUX_PKG_STORAGE_KEY);
      if (stored === "rpm" || stored === "deb" || stored === "appimage") {
        return stored;
      }
    } catch {
      // ignore private-mode / blocked storage
    }
  }

  return detectLinuxPackageFormat() ?? "deb";
}

export function rememberLinuxPackageFormat(format: LinuxPackageFormat): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LINUX_PKG_STORAGE_KEY, format);
  } catch {
    // ignore
  }
}

export type PlatformId = "windows" | "macos" | "linux" | "ios" | "android";

export interface PlatformDef {
  id: PlatformId;
  name: string;
  available: boolean;
}

export const PLATFORMS: PlatformDef[] = [
  { id: "windows", name: "Windows", available: true },
  { id: "linux", name: "Linux", available: true },
  { id: "macos", name: "macOS", available: true },
  { id: "ios", name: "iOS", available: false },
  { id: "android", name: "Android", available: false },
];

export function detectPlatform(): PlatformId | null {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return null;
}

export function platformLabel(id: PlatformId | null): string {
  if (!id) return "your platform";
  return PLATFORMS.find((p) => p.id === id)?.name ?? "your platform";
}

export function isPlatformAvailable(id: PlatformId | null): boolean {
  if (!id) return false;
  return PLATFORMS.find((p) => p.id === id)?.available ?? false;
}
