import type { IconType } from "react-icons";
import { DiAndroid } from "react-icons/di";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import type { PlatformId } from "@/lib/platform";

interface PlatformIconProps {
  platform: PlatformId;
  size?: number;
  className?: string;
}

const ICONS: Record<PlatformId, IconType> = {
  windows: FaWindows,
  macos: FaApple,
  linux: FaLinux,
  ios: FaApple,
  android: DiAndroid,
};

export function PlatformIcon({ platform, size = 18, className }: PlatformIconProps) {
  const Icon = ICONS[platform];
  return <Icon size={size} className={className} aria-hidden />;
}
