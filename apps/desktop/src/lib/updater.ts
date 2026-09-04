import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isMobileRuntime } from "../hooks/useIsMobile";

export type UpdateCheckResult =
  | { status: "current" }
  | { status: "available"; update: Update; version: string }
  | { status: "unavailable"; message: string };

export function isUpdaterSupported(): boolean {
  if (import.meta.env.DEV) return false;
  // Desktop-only: updater targets Win/Linux/macOS installers, not Android APKs.
  if (isMobileRuntime()) return false;
  return true;
}

export function formatUpdateError(error: unknown): string {
  const message = String(error);

  if (
    message.includes("valid release JSON") ||
    message.includes("404") ||
    message.includes("Not Found")
  ) {
    return "No published release yet. Updates appear after the first signed release is uploaded.";
  }

  if (message.includes("network") || message.includes("fetch")) {
    return "Could not reach the update server. Check your internet connection and try again.";
  }

  if (/unexpected\s+os|unsupported\s+os|unknown\s+os/i.test(message)) {
    return "Auto-updates are not available on this platform.";
  }

  return message.replace(/^Error:\s*/i, "");
}

export async function checkForUpdateSilent(): Promise<Extract<UpdateCheckResult, { status: "available" }> | null> {
  const result = await checkForUpdate();
  if (result.status === "available") return result;
  return null;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isUpdaterSupported()) {
    return {
      status: "unavailable",
      message: isMobileRuntime()
        ? "Auto-updates are for desktop builds. Install a new APK when a mobile release is ready."
        : "Auto-updates work in release builds only, not in dev mode.",
    };
  }

  try {
    const update = await check();
    if (!update) return { status: "current" };
    return { status: "available", update, version: update.version };
  } catch (error) {
    return { status: "unavailable", message: formatUpdateError(error) };
  }
}

export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
