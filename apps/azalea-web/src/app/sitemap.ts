import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  return [
    { url: siteUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/download`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/self-host`, lastModified, changeFrequency: "weekly", priority: 0.85 },
  ];
}
