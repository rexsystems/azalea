import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Free SSH sync & Pro vault storage",
  description:
    "Azalea Free includes unlimited local hosts and encrypted cloud sync. Upgrade Pro for a larger zero-knowledge vault. Open-source SSH client pricing.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Azalea pricing",
    description: "Free sync included. Pay only for more encrypted cloud vault storage.",
    url: "/pricing",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
