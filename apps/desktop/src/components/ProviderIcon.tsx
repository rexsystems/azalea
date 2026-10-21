import type { AccountKind } from "../lib/api";

type ProviderId = "gdrive" | "onedrive" | "dropbox";

const iconModules = import.meta.glob("../assets/provider-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const PROVIDER_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(iconModules).map(([path, url]) => {
    const file = path.split("/").pop() ?? "";
    const id = file.replace(/\.svg$/i, "");
    return [id, url];
  }),
);

const PROVIDER_FILE: Record<ProviderId, string> = {
  gdrive: "google-drive",
  onedrive: "onedrive",
  dropbox: "dropbox",
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  gdrive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
};

export function providerFromKind(
  kind: AccountKind | null | undefined,
): ProviderId | null {
  if (kind === "gdrive" || kind === "onedrive" || kind === "dropbox") {
    return kind;
  }
  return null;
}

interface ProviderIconProps {
  provider: ProviderId;
  size?: number;
}

/** Brand marks from Dashboard Icons (homarr-labs/dashboard-icons). */
export function ProviderIcon({ provider, size = 18 }: ProviderIconProps) {
  const file = PROVIDER_FILE[provider];
  const src = PROVIDER_ICONS[file];
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      title={PROVIDER_LABEL[provider]}
      aria-hidden
    />
  );
}
