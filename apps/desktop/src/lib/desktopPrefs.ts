import { invoke } from "@tauri-apps/api/core";
import { isMobileRuntime } from "../hooks/useIsMobile";

export interface DesktopPreferences {
  closeToTray: boolean;
}

export interface DesktopPrefsStatus {
  preferences: DesktopPreferences;
  trayAvailable: boolean;
}

export async function getDesktopPrefs(): Promise<DesktopPrefsStatus> {
  if (isMobileRuntime()) {
    return { preferences: { closeToTray: false }, trayAvailable: false };
  }
  return invoke<DesktopPrefsStatus>("desktop_prefs_get");
}

export async function setDesktopPrefs(
  preferences: DesktopPreferences,
): Promise<DesktopPrefsStatus> {
  return invoke<DesktopPrefsStatus>("desktop_prefs_set", { preferences });
}
