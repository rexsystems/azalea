import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download SSH client for Windows, Linux & macOS",
  description:
    "Download Azalea, the open-source SSH terminal client for Windows, Linux, and macOS. Get installers for .exe, .deb, .rpm, AppImage, and macOS DMG.",
  alternates: { canonical: "/download" },
  openGraph: {
    title: "Download Azalea — SSH terminal client",
    description:
      "Install Azalea on Windows, Linux, or macOS. Multi-tab SSH, SFTP, keys, and encrypted sync.",
    url: "/download",
  },
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
