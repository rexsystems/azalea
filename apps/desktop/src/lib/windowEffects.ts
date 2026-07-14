import { isTauri } from "@tauri-apps/api/core";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeId } from "./theme";

function setNativeGlossy(enabled: boolean) {
  document.documentElement.classList.toggle("glossy-native", enabled);
}

export async function applyThemeWindowEffects(theme: ThemeId) {
  if (!isTauri()) {
    setNativeGlossy(false);
    return;
  }

  const win = getCurrentWindow();

  if (theme !== "glossy") {
    setNativeGlossy(false);
    try {
      await win.clearEffects();
    } catch {
      // ignore on unsupported platforms
    }
    return;
  }

  try {
    await win.setEffects({ effects: [Effect.Mica] });
    setNativeGlossy(true);
    return;
  } catch {
    // Windows 10 / older builds
  }

  try {
    await win.setEffects({
      effects: [Effect.Acrylic],
      color: "#0c0e16cc",
    });
    setNativeGlossy(true);
  } catch {
    setNativeGlossy(false);
  }
}
