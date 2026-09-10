export type IconPackId = "hugeicons" | "pixelart";

export interface IconPackDefinition {
  id: IconPackId;
  name: string;
  description: string;
}

export const iconPacks: IconPackDefinition[] = [
  {
    id: "hugeicons",
    name: "Hugeicons",
    description: "Default rounded stroke icons.",
  },
  {
    id: "pixelart",
    name: "Pixelarticons",
    description: "Experimental 24×24 pixel set.",
  },
];

const STORAGE_KEY = "azalea-icon-pack";

export function getStoredIconPack(): IconPackId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && iconPacks.some((p) => p.id === stored)) {
    return stored as IconPackId;
  }
  return "hugeicons";
}

export function setStoredIconPack(id: IconPackId) {
  localStorage.setItem(STORAGE_KEY, id);
  document.documentElement.dataset.iconPack = id;
  window.dispatchEvent(new CustomEvent("azalea-icon-pack", { detail: id }));
}

export function applyIconPack(id: IconPackId) {
  document.documentElement.dataset.iconPack = id;
}
