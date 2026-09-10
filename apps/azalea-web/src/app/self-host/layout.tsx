import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-host azalea-server",
  description:
    "Install azalea-server with one command. Run encrypted Azalea sync on your own VPS with Docker.",
  alternates: { canonical: "/self-host" },
  openGraph: {
    title: "Self-host Azalea sync",
    description:
      "One-line installer for azalea-server. Docker-based encrypted sync you control.",
    url: "/self-host",
  },
};

export default function SelfHostLayout({ children }: { children: React.ReactNode }) {
  return children;
}
