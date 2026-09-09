"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlatformIcon } from "./PlatformIcon";
import { detectPlatform, type PlatformId } from "@/lib/platform";

export function NavDownloadLink() {
  const [platform, setPlatform] = useState<PlatformId>("windows");

  useEffect(() => {
    setPlatform(detectPlatform() ?? "windows");
  }, []);

  return (
    <Link href="/download" className="btn btn-nav">
      <PlatformIcon platform={platform} size={15} />
      <span className="hidden sm:inline">Download</span>
      <span className="sm:hidden">Get</span>
    </Link>
  );
}
