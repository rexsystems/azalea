import { HostMark } from "./HostMark";

interface HostOsIconProps {
  osId?: string | null;
  seed: string;
  size?: number;
  rounded?: number;
}

const iconModules = import.meta.glob("../assets/os-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const OS_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(iconModules).map(([path, url]) => {
    const file = path.split("/").pop() ?? "";
    const id = file.replace(/\.svg$/i, "");
    return [id, url];
  }),
);

/** Aliases -> asset filename stem under assets/os-icons. */
const OS_ALIAS: Record<string, string> = {
  ubuntu: "ubuntu",
  debian: "debian",
  fedora: "fedora",
  arch: "arch",
  manjaro: "arch",
  endeavouros: "arch",
  garuda: "arch",
  centos: "centos",
  rhel: "rhel",
  redhat: "rhel",
  rocky: "rocky",
  alma: "alma",
  almalinux: "alma",
  opensuse: "opensuse",
  suse: "opensuse",
  alpine: "alpine",
  pop: "pop",
  "pop-os": "pop",
  mint: "mint",
  linuxmint: "mint",
  kali: "kali",
  amazon: "amazon",
  amzn: "amazon",
  raspberry: "raspberry",
  raspbian: "raspberry",
  gentoo: "gentoo",
  void: "void",
  nixos: "nixos",
  linux: "linux",
  macos: "macos",
  darwin: "macos",
  windows: "windows",
  freebsd: "freebsd",
  openbsd: "openbsd",
  nobara: "nobara",
  proxmox: "proxmox",
  pve: "proxmox",
};

/** Deep brand-tinted tile behind each logo. */
const OS_BG: Record<string, string> = {
  ubuntu: "#3d1408",
  debian: "#3a0012",
  fedora: "#0d2a3d",
  arch: "#06283a",
  centos: "#12123a",
  rhel: "#3d0000",
  rocky: "#052e22",
  alma: "#06243d",
  opensuse: "#1a2e08",
  alpine: "#041e2a",
  pop: "#0a2e32",
  mint: "#1a2e0a",
  kali: "#0a1a3d",
  amazon: "#3d2800",
  raspberry: "#3a0a18",
  gentoo: "#1c1630",
  void: "#0f241c",
  nixos: "#121e3a",
  linux: "#2e2400",
  macos: "#1c1c1e",
  windows: "#002a4a",
  freebsd: "#3a0e0c",
  openbsd: "#2e2400",
  nobara: "#1a1028",
  proxmox: "#3a1808",
};

function resolveIcon(osId: string): { key: string; src: string } | null {
  const key = OS_ALIAS[osId] ?? osId;
  const src = OS_ICONS[key];
  if (!src) return null;
  return { key, src };
}

export function HostOsIcon({ osId, seed, size = 48, rounded = 10 }: HostOsIconProps) {
  const raw = (osId || "").toLowerCase();
  if (!raw) {
    return <HostMark seed={seed} size={size} rounded={rounded} />;
  }

  const resolved = resolveIcon(raw);
  if (!resolved) {
    return <HostMark seed={seed} size={size} rounded={rounded} />;
  }

  const pad = Math.max(6, Math.round(size * 0.16));
  const bg = OS_BG[resolved.key] ?? "#1a1a1e";

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: bg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${bg} 60%, white 12%)`,
        padding: pad,
      }}
      title={resolved.key}
      aria-label={`${resolved.key} host`}
    >
      <img
        src={resolved.src}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
