import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadPublicEnvFile(): Record<string, string> {
  const filePath = path.join(__dirname, "azalea.public.env");
  if (!existsSync(filePath)) return {};

  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const publicEnv = loadPublicEnvFile();

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: { root: path.resolve(__dirname) },
  env: {
    NEXT_PUBLIC_AZALEA_API_URL:
      process.env.NEXT_PUBLIC_AZALEA_API_URL ?? publicEnv.NEXT_PUBLIC_AZALEA_API_URL ?? "",
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ?? publicEnv.NEXT_PUBLIC_SITE_URL ?? "",
    NEXT_PUBLIC_GITHUB_REPO:
      process.env.NEXT_PUBLIC_GITHUB_REPO ?? publicEnv.NEXT_PUBLIC_GITHUB_REPO ?? "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  },
};

export default nextConfig;
